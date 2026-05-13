const {
    ECRClient,
    DescribeRegistryCommand,
    PutReplicationConfigurationCommand,
} = require('@aws-sdk/client-ecr');

const region = process.env.AWS_REGION;
const ecr = new ECRClient({ region });

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function canonicalDestinationKey(destinations) {
    return destinations
        .map((d) => `${d.region}:${d.registryId}`)
        .sort()
        .join('|');
}

function ruleManagesRepo(rule, repoName) {
    if (!rule.repositoryFilters) return false;
    return rule.repositoryFilters.some(
        (f) => f.filterType === 'PREFIX_MATCH' && f.filter === repoName,
    );
}

/**
 * Build the merged set of rules.
 *
 * `existingRules` is the current registry config returned by DescribeRegistry.
 * `managedSpecs` is the array of { repositoryName, destinations[] } to (re)write.
 * `stripNames` is the set of repo names to remove from existing rules first
 *   (used on both Create/Update — strip the previous version of our rules
 *   before re-emitting fresh ones — and Delete, where managedSpecs is empty
 *   and we only want to strip).
 *
 * Strategy:
 * 1. Strip out any filters matching `stripNames` from existing rules. If a
 *    rule's filter list becomes empty, drop the rule entirely.
 * 2. For each managedSpec, group by canonical destination set. One ECR rule
 *    per destination set, holding all our managed repo filters that share
 *    that destination set. This keeps us under the 10-rules-per-registry cap
 *    until the user has more than 10 unique destination sets across all
 *    builders in the account.
 * 3. Preserve every other rule untouched.
 */
function buildMergedRules(existingRules, managedSpecs, stripNames) {
    const stripSet = stripNames instanceof Set ? stripNames : new Set(stripNames);

    const preserved = (existingRules || []).filter((rule) => {
        if (!rule.repositoryFilters || rule.repositoryFilters.length === 0) {
            // A rule with no filters means "replicate everything" — not ours.
            return true;
        }
        const remainingFilters = rule.repositoryFilters.filter(
            (f) => !(f.filterType === 'PREFIX_MATCH' && stripSet.has(f.filter)),
        );
        if (remainingFilters.length === 0) return false;
        rule.repositoryFilters = remainingFilters;
        return true;
    });

    const groupsByDestKey = new Map();
    for (const spec of managedSpecs) {
        if (!spec.destinations || spec.destinations.length === 0) continue;
        const key = canonicalDestinationKey(spec.destinations);
        let group = groupsByDestKey.get(key);
        if (!group) {
            group = { destinations: spec.destinations, repos: new Set() };
            groupsByDestKey.set(key, group);
        }
        group.repos.add(spec.repositoryName);
    }

    const generated = [];
    for (const group of groupsByDestKey.values()) {
        generated.push({
            destinations: group.destinations,
            repositoryFilters: [...group.repos].map((repoName) => ({
                filter: repoName,
                filterType: 'PREFIX_MATCH',
            })),
        });
    }

    return [...preserved, ...generated];
}

async function putWithRetry(rules) {
    const maxAttempts = 5;
    let lastErr;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
            await ecr.send(new PutReplicationConfigurationCommand({
                replicationConfiguration: { rules },
            }));
            return;
        } catch (err) {
            lastErr = err;
            const retryable = err.name === 'LimitExceededException'
                || err.name === 'ValidationException'
                || err.name === 'ServerException'
                || err.name === 'ThrottlingException';
            if (!retryable) throw err;
            const delay = 500 * 2 ** attempt;
            console.warn(`PutReplicationConfiguration ${err.name}, retrying in ${delay}ms`);
            await sleep(delay);
        }
    }
    throw lastErr;
}

exports.handler = async (event) => {
    console.log('Event:', JSON.stringify(event, null, 2));

    const physicalResourceId = event.PhysicalResourceId || event.LogicalResourceId;
    const isDelete = event.RequestType === 'Delete';

    // ResourceProperties.ManagedSpecs is present on every event type — for
    // Delete events, CFN sends the last-known property values, so we can
    // still identify which repo names are "ours" and strip them.
    const currentManagedSpecs = JSON.parse(
        event.ResourceProperties?.ManagedSpecs || '[]',
    );
    const previousManagedSpecs = JSON.parse(
        event.OldResourceProperties?.ManagedSpecs || '[]',
    );

    // Names to strip from existing rules: union of current and previous repo
    // names. On Create/Update: strip the prior version of our rules and
    // re-emit fresh ones. On Delete: strip everything we ever managed.
    const stripNames = new Set([
        ...currentManagedSpecs.map((s) => s.repositoryName),
        ...previousManagedSpecs.map((s) => s.repositoryName),
    ]);
    const specsToWrite = isDelete ? [] : currentManagedSpecs;

    const describe = await ecr.send(new DescribeRegistryCommand({}));
    const existingRules = describe.replicationConfiguration?.rules || [];

    const merged = buildMergedRules(existingRules, specsToWrite, stripNames);
    console.log('Merged rules:', JSON.stringify(merged, null, 2));

    await putWithRetry(merged);

    return {
        PhysicalResourceId: physicalResourceId,
        Data: {
            RulesApplied: String(merged.length),
        },
    };
};

// Exported for unit tests; not part of the Lambda handler contract.
exports._internal = { buildMergedRules, canonicalDestinationKey };
