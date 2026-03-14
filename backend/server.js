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
const FOOTBALL_KEY = process.env.FOOTBALL_API_KEY;
const FOOTBALL_BASE = 'https://api-football-v1.p.rapidapi.com/v3';

const footballHeaders = {
  'X-RapidAPI-Key': FOOTBALL_KEY,
  'X-RapidAPI-Host': 'api-football-v1.p.rapidapi.com'
};

const LEAGUES = [
  { id: 39,  name: 'Premier League',   flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿' },
  { id: 140, name: 'La Liga',          flag: '🇪🇸' },
  { id: 78,  name: 'Bundesliga',       flag: '🇩🇪' },
  { id: 135, name: 'Serie A',          flag: '🇮🇹' },
  { id: 61,  name: 'Ligue 1',          flag: '🇫🇷' },
  { id: 88,  name: 'Eredivisie',       flag: '🇳🇱' },
  { id: 94,  name: 'Primeira Liga',    flag: '🇵🇹' },
  { id: 307, name: 'Saudi Pro League', flag: '🇸🇦' },
  { id: 2,   name: 'Champions League', flag: '🏆' },
];

async function fetchFromFootballAPI(endpoint) {
  try {
    const res = await fetch(`${FOOTBALL_BASE}${endpoint}`, {
      headers: footballHeaders
    });
    const data = await res.json();
    return data.response || [];
  } catch (err) {
    console.error('Football API error:', err.message);
    return [];
  }
}

async function getFixturesWithData(leagueId, season) {
  const fixtures = await fetchFromFootballAPI(
    `/fixtures?league=${leagueId}&season=${season}&next=8&status=NS`
  );

  const enriched = [];

  for (const fixture of fixtures.slice(0, 6)) {
    const homeId = fixture.teams.home.id;
    const awayId = fixture.teams.away.id;

    const [homeStats, awayStats, homeLastFive, awayLastFive, injuries] =
      await Promise.all([
        fetchFromFootballAPI(`/teams/statistics?team=${homeId}&league=${leagueId}&season=${season}`),
        fetchFromFootballAPI(`/teams/statistics?team=${awayId}&league=${leagueId}&season=${season}`),
        fetchFromFootballAPI(`/fixtures?team=${homeId}&league=${leagueId}&season=${season}&last=15`),
        fetchFromFootballAPI(`/fixtures?team=${awayId}&league=${leagueId}&season=${season}&last=15`),
        fetchFromFootballAPI(`/injuries?fixture=${fixture.fixture.id}`),
      ]);

    const homeS = homeStats[0] || {};
    const awayS = awayStats[0] || {};

    enriched.push({
      fixtureId: fixture.fixture.id,
      date: fixture.fixture.date,
      league: fixture.league.name,
      leagueFlag: LEAGUES.find(l => l.id === leagueId)?.flag || '',
      home: {
        name: fixture.teams.home.name,
        form: homeS.form || '',
        goalsForAvgHome: homeS.goals?.for?.average?.home || 0,
        goalsAgainstAvgHome: homeS.goals?.against?.average?.home || 0,
        cleanSheetsHome: homeS.clean_sheet?.home || 0,
        last15Goals: homeLastFive.map(f => {
          const isHome = f.teams.home.id === homeId;
          return isHome ? f.goals.home : f.goals.away;
        }).filter(g => g !== null),
        injuries: injuries
          .filter(i => i.team?.id === homeId)
          .map(i => `${i.player?.name} (${i.player?.reason})`),
      },
      away: {
        name: fixture.teams.away.name,
        form: awayS.form || '',
        goalsForAvgAway: awayS.goals?.for?.average?.away || 0,
        goalsAgainstAvgAway: awayS.goals?.against?.average?.away || 0,
        cleanSheetsAway: awayS.clean_sheet?.away || 0,
        last15Goals: awayLastFive.map(f => {
          const isAway = f.teams.away.id === awayId;
          return isAway ? f.goals.away : f.goals.home;
        }).filter(g => g !== null),
        injuries: injuries
          .filter(i => i.team?.id === awayId)
          .map(i => `${i.player?.name} (${i.player?.reason})`),
      }
    });

    await new Promise(r => setTimeout(r, 300));
  }

  return enriched;
}

async function analyseWithClaude(fixturesData) {
  const prompt = `You are an elite football analyst with deep knowledge of tactics, form, injuries and statistics across all major leagues. 

Analyse this fixture data carefully and predict which teams will score this weekend. Use your knowledge of each team's playing style, manager tendencies, historical patterns, and the statistics provided.

For each fixture evaluate:
1. Recent form (last 15 games goals scored)
2. Home/away scoring averages this season
3. Opponent defensive strength (goals conceded average)
4. Key injuries and their impact
5. Style of play and tactical matchup
6. Historical patterns between these clubs

Return ONLY a valid JSON array. No markdown, no explanation, just the raw JSON array:

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

Fixture data to analyse:
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

app.get('/api/predictions', async (req, res) => {
  try {
    console.log('Fetching fixtures from API-Football...');
    const season = 2025;
    let allFixtures = [];

    for (const league of LEAGUES) {
      console.log(`Fetching ${league.name}...`);
      const fixtures = await getFixturesWithData(league.id, season);
      allFixtures = [...allFixtures, ...fixtures];
      await new Promise(r => setTimeout(r, 500));
    }

    console.log(`Total fixtures fetched: ${allFixtures.length}`);
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
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});