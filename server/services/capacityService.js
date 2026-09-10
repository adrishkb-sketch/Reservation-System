/**
 * Central Capacity & Grouping Logic Service
 * Determines capacity buckets and validates student eligibility.
 */

function resolveBucketKey(grouping, dept, program, year) {
  const parts = [];
  if (grouping.group_dept) parts.push(`DEPT:${dept}`);
  if (grouping.group_prog) parts.push(`PROG:${program}`);
  if (grouping.group_year) parts.push(`YEAR:${year}`);
  
  return parts.length > 0 ? parts.join('|') : 'GLOBAL';
}

function getBucketDisplayName(grouping, dept, program, year) {
  const parts = [];
  if (grouping.group_dept) parts.push(dept);
  if (grouping.group_prog) parts.push(program);
  if (grouping.group_year) parts.push(year);
  
  return parts.length > 0 ? parts.join(' • ') : 'General Capacity (All Eligible)';
}

/**
 * Given eligible items and grouping config, generates unique capacity bucket definitions.
 * @param {Array<{department: string, program: string, year: string}>} eligibilityList
 * @param {{group_dept: number|boolean, group_prog: number|boolean, group_year: number|boolean}} grouping
 */
function generateBucketsFromEligibility(eligibilityList, grouping) {
  const map = new Map();

  for (const item of eligibilityList) {
    const key = resolveBucketKey(grouping, item.department, item.program, item.year);
    if (!map.has(key)) {
      map.set(key, {
        bucket_key: key,
        display_name: getBucketDisplayName(grouping, item.department, item.program, item.year),
        dept: grouping.group_dept ? item.department : null,
        program: grouping.group_prog ? item.program : null,
        year: grouping.group_year ? item.year : null,
      });
    }
  }

  return Array.from(map.values());
}

/**
 * Explains what grouping switches mean in plain human readable text
 */
function explainGrouping(grouping) {
  const { group_dept, group_prog, group_year } = grouping;
  if (group_dept && group_prog && group_year) {
    return 'Separate capacity for every individual Department + Program + Year combination.';
  }
  if (!group_dept && !group_prog && group_year) {
    return 'Capacity is pooled by Year only. Students across all eligible departments and programs share the same year pool.';
  }
  if (group_dept && !group_prog && group_year) {
    return 'Capacity is grouped by Department + Year. Students in B.Tech and M.Tech in the same department and year share the pool.';
  }
  if (!group_dept && group_prog && group_year) {
    return 'Capacity is grouped by Program + Year. All eligible departments in the same program and year share the pool.';
  }
  if (group_dept && !group_prog && !group_year) {
    return 'Capacity is pooled by Department only. All programs and years in each department share their department pool.';
  }
  if (!group_dept && group_prog && !group_year) {
    return 'Capacity is pooled by Program only (e.g. B.Tech vs M.Tech).';
  }
  if (group_dept && group_prog && !group_year) {
    return 'Capacity is grouped by Department + Program.';
  }
  return 'Single global capacity pool for all eligible students in the event.';
}

module.exports = {
  resolveBucketKey,
  getBucketDisplayName,
  generateBucketsFromEligibility,
  explainGrouping
};
