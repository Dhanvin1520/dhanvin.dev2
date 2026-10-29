// Vercel serverless function: GET /api/stats
// Fetches real GitHub and LeetCode numbers on the server and lets Vercel's CDN cache them,
// so visitors never hit the per-IP rate limits of the public APIs.
// Optional: set a GITHUB_TOKEN environment variable in Vercel (a token with no scopes is enough)
// to raise GitHub's limit from 60 to 5,000 requests per hour.

const GH_USER = 'Dhanvin1520';
const LC_USER = 'dhanvin_1520';

async function fetchJson(url, options = {}) {
    const res = await fetch(url, { ...options, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
    return res.json();
}

async function getGitHub() {
    const headers = { 'Accept': 'application/vnd.github+json', 'User-Agent': 'dhanvin-portfolio' };
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

    const [user, repos] = await Promise.all([
        fetchJson(`https://api.github.com/users/${GH_USER}`, { headers }),
        fetchJson(`https://api.github.com/users/${GH_USER}/repos?per_page=100`, { headers })
    ]);

    const counts = {};
    repos.filter(r => !r.fork && r.language)
        .forEach(r => { counts[r.language] = (counts[r.language] || 0) + 1; });
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];

    return {
        publicRepos: user.public_repos,
        followers: user.followers,
        createdAt: user.created_at,
        topLanguage: top ? top[0] : null
    };
}

async function getLeetCode() {
    const data = await fetchJson('https://leetcode.com/graphql', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Referer': `https://leetcode.com/u/${LC_USER}/`,
            'User-Agent': 'Mozilla/5.0 (dhanvin-portfolio)'
        },
        body: JSON.stringify({
            query: 'query($u:String!){matchedUser(username:$u){submitStatsGlobal{acSubmissionNum{difficulty count}}}}',
            variables: { u: LC_USER }
        })
    });
    const rows = data?.data?.matchedUser?.submitStatsGlobal?.acSubmissionNum;
    if (!Array.isArray(rows)) throw new Error('LeetCode: unexpected response shape');
    const by = Object.fromEntries(rows.map(r => [r.difficulty, r.count]));
    return { solved: by.All, easy: by.Easy, medium: by.Medium, hard: by.Hard };
}

module.exports = async (req, res) => {
    const [gh, lc] = await Promise.allSettled([getGitHub(), getLeetCode()]);
    const body = {
        github: gh.status === 'fulfilled' ? gh.value : null,
        leetcode: lc.status === 'fulfilled' ? lc.value : null,
        fetchedAt: new Date().toISOString()
    };
    if (gh.status === 'rejected') console.error('GitHub stats failed:', gh.reason?.message);
    if (lc.status === 'rejected') console.error('LeetCode stats failed:', lc.reason?.message);

    // Cache full results for an hour; retry partial failures sooner.
    const complete = body.github && body.leetcode;
    res.setHeader('Cache-Control', complete
        ? 's-maxage=3600, stale-while-revalidate=86400'
        : 's-maxage=300, stale-while-revalidate=600');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.statusCode = 200;
    res.end(JSON.stringify(body));
};
