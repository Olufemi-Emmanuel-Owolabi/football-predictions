import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import fetch from 'node-fetch';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const FOOTBALL_DATA_KEY = process.env.FOOTBALL_DATA_KEY;
const FOOTBALL_DATA_BASE = 'https://api.football-data.org/v4';

const footballDataHeaders = {
  'X-Auth-Token': FOOTBALL_DATA_KEY
};

const COMPETITIONS = [
  { code: 'PL',  name: 'Premier League',    flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿' },
  { code: 'PD',  name: 'La Liga',           flag: '🇪🇸' },
  { code: 'BL1', name: 'Bundesliga',        flag: '🇩🇪' },
  { code: 'SA',  name: 'Serie A',           flag: '🇮🇹' },
  { code: 'FL1', name: 'Ligue 1',           flag: '🇫🇷' },
  { code: 'PPL', name: 'Primeira Liga',     flag: '🇵🇹' },
  { code: 'CL',  name: 'Champions League',  flag: '🏆' },
];

async function fetchFootballData(endpoint) {
  try {
    const res = await fetch(`${FOOTBALL_DATA_BASE}${endpoint}`, {
      headers: footballDataHeaders
    });
    const data = await res.json();
    if (data.errorCode) {
      console.error('Football Data error:', data.message);
      return null;
    }
    return data;
  } catch (err) {
    console.error('Fetch error:', err.message);
    return null;
  }
}

async function getFixturesWithData(competitionCode, competitionName, flag) {
  const today = new Date();
  const nextWeek = new Date();
  nextWeek.setDate(today.getDate() + 7);

  const dateFrom = today.toISOString().split('T')[0];
  const dateTo = nextWeek.toISOString().split('T')[0];

  const data = await fetchFootballData(
    `/competitions/${competitionCode}/matches?dateFrom=${dateFrom}&dateTo=${dateTo}&status=SCHEDULED`
  );

  if (!data?.matches?.length) {
    console.log(`${competitionName}: 0 fixtures found`);
    return [];
  }

  console.log(`${competitionName}: ${data.matches.length} fixtures found`);

  const enriched = [];

  for (const match of data.matches.slice(0, 6)) {
    const homeId = match.homeTeam.id;
    const awayId = match.awayTeam.id;

    const [homeForm, awayForm] = await Promise.all([
      fetchFootballData(`/teams/${homeId}/matches?status=FINISHED&limit=10`),
      fetchFootballData(`/teams/${awayId}/matches?status=FINISHED&limit=10`),
    ]);

    const getGoals = (matches, teamId) => {
      if (!matches?.matches) return [];
      return matches.matches.map(m => {
        const isHome = m.homeTeam.id === teamId;
        return isHome ? m.score.fullTime.home : m.score.fullTime.away;
      }).filter(g => g !== null);
    };

    const getForm = (matches, teamId) => {
      if (!matches?.matches) return '';
      return matches.matches.slice(-5).map(m => {
        const isHome = m.homeTeam.id === teamId;
        const scored = isHome ? m.score.fullTime.home : m.score.fullTime.away;
        const conceded = isHome ? m.score.fullTime.away : m.score.fullTime.home;
        if (scored > conceded) return 'W';
        if (scored < conceded) return 'L';
        return 'D';
      }).join('');
    };

    enriched.push({
      fixtureId: match.id,
      date: match.utcDate,
      league: competitionName,
      leagueFlag: flag,
      home: {
        name: match.homeTeam.name,
        form: getForm(homeForm, homeId),
        last10Goals: getGoals(homeForm, homeId),
        goalsAvg: homeForm?.matches?.length
          ? (getGoals(homeForm, homeId).reduce((a,b) => a+b, 0) / homeForm.matches.length).toFixed(2)
          : 0,
      },
      away: {
        name: match.awayTeam.name,
        form: getForm(awayForm, awayId),
        last10Goals: getGoals(awayForm, awayId),
        goalsAvg: awayForm?.matches?.length
          ? (getGoals(awayForm, awayId).reduce((a,b) => a+b, 0) / awayForm.matches.length).toFixed(2)
          : 0,
      }
    });

    await new Promise(r => setTimeout(r, 100));
  }

  return enriched;
}

async function analyseWithClaude(fixturesData) {
  const prompt = `You are an elite football analyst with deep knowledge of tactics, form, injuries and statistics across all major leagues.

Analyse this fixture data and predict which teams will score. Consider:
1. Recent form (last 10 games goals scored)
2. Goals scoring average
3. Home vs away patterns
4. Style of play and tactical matchup
5. Use your own knowledge of these teams to supplement the data

Return ONLY a valid JSON array, no markdown, no explanation:
[
  {
    "fixtureId": number,
    "league": "string",
    "leagueFlag": "string",
    "homeTeam": "string",
    "awayTeam": "string",
    "date": "string",
    "homeWillScore": boolean,
    "awayWillScore": boolean,
    "confidence": "very-high" | "high" | "medium" | "low",
    "homeScoreProb": number,
    "awayScoreProb": number,
    "keyStar": "string or null",
    "reasoning": "string",
    "statInsight": "string",
    "injuryImpact": "string or null"
  }
]

Fixture data:
${JSON.stringify(fixturesData, null, 2)}`;

  const response = await claude.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8000,
    messages: [{ role: 'user', content: prompt }]
  });

  const text = response.content[0].text.trim();
  const clean = text.replace(/```json|```/g, '').trim();
  return JSON.parse(clean);
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/test', async (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const nextWeek = new Date(Date.now() + 7*24*60*60*1000).toISOString().split('T')[0];
  const data = await fetchFootballData(
    `/competitions/PL/matches?dateFrom=${today}&dateTo=${nextWeek}&status=SCHEDULED`
  );
  res.json({
    key_set: !!FOOTBALL_DATA_KEY,
    key_preview: FOOTBALL_DATA_KEY ? FOOTBALL_DATA_KEY.substring(0, 8) + '...' : 'MISSING',
    fixtures_found: data?.matches?.length || 0,
    sample: data?.matches?.[0] || null,
    error: data?.message || null
  });
});

app.get('/api/predictions', async (req, res) => {
  try {
    console.log('Fetching fixtures from football-data.org...');
    let allFixtures = [];

    for (const comp of COMPETITIONS) {
      console.log(`Fetching ${comp.name}...`);
      const fixtures = await getFixturesWithData(comp.code, comp.name, comp.flag);
      allFixtures = [...allFixtures, ...fixtures];
      await new Promise(r => setTimeout(r, 1000));
    }

    console.log(`Total fixtures fetched: ${allFixtures.length}`);

    if (allFixtures.length === 0) {
      return res.json({
        success: false,
        error: 'No fixtures found. Check your FOOTBALL_DATA_KEY on Render.',
        predictions: []
      });
    }

    console.log('Sending to Claude for analysis...');
    const predictions = await analyseWithClaude(allFixtures);
    console.log(`Claude returned ${predictions.length} predictions`);

    res.json({
      success: true,
      predictions,
      totalFixtures: allFixtures.length,
      generatedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('Prediction error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});