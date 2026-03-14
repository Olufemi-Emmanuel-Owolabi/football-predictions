import { useState, useEffect } from 'react';
import './App.css';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3000';

const CONF_STYLES = {
  'very-high': { bg: '#e8f5e9', color: '#2e7d32', label: 'Very high' },
  'high':      { bg: '#e3f2fd', color: '#1565c0', label: 'High' },
  'medium':    { bg: '#fff8e1', color: '#f57f17', label: 'Medium' },
  'low':       { bg: '#fce4ec', color: '#c62828', label: 'Low' },
};

function FixtureCard({ p }) {
  const [open, setOpen] = useState(false);
  const cs = CONF_STYLES[p.confidence] || CONF_STYLES.medium;
  const total = p.homeScoreProb + p.awayScoreProb;
  const homeW = Math.round((p.homeScoreProb / total) * 100);

  return (
    <div className="card" onClick={() => setOpen(!open)}>
      <div className="card-header">
        <span className="league-badge">{p.leagueFlag} {p.league}</span>
        <span className="conf-badge" style={{ background: cs.bg, color: cs.color }}>
          {cs.label}
        </span>
      </div>

      <div className="teams-row">
        <div className="team home">
          <span className="team-name">{p.homeTeam}</span>
          <span className={`score-badge ${p.homeWillScore ? 'scores' : 'unlikely'}`}>
            {p.homeWillScore ? '● Scores' : '○ Unlikely'}
          </span>
        </div>
        <span className="vs">vs</span>
        <div className="team away">
          <span className="team-name">{p.awayTeam}</span>
          <span className={`score-badge ${p.awayWillScore ? 'scores' : 'unlikely'}`}>
            {p.awayWillScore ? '● Scores' : '○ Unlikely'}
          </span>
        </div>
      </div>

      <div className="prob-bar-row">
        <span className="prob-label">{p.homeScoreProb}%</span>
        <div className="prob-bar">
          <div className="prob-fill" style={{ width: `${homeW}%` }} />
        </div>
        <span className="prob-label">{p.awayScoreProb}%</span>
      </div>

      {open && (
        <div className="expanded">
          <p className="reasoning">{p.reasoning}</p>
          {p.statInsight && (
            <div className="insight-box info">
              <strong>Stats: </strong>{p.statInsight}
            </div>
          )}
          {p.injuryImpact && (
            <div className="insight-box warning">
              <strong>Injuries: </strong>{p.injuryImpact}
            </div>
          )}
          {p.keyStar && (
            <div className="insight-box success">
              <strong>Key player: </strong>{p.keyStar}
            </div>
          )}
        </div>
      )}

      <div className="expand-hint">{open ? '▲ less' : '▼ full analysis'}</div>
    </div>
  );
}

export default function App() {
  const [predictions, setPredictions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [generatedAt, setGeneratedAt] = useState(null);
  const [activeLeague, setActiveLeague] = useState('all');
  const [activeConf, setActiveConf] = useState('all');

  const fetchPredictions = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${BACKEND_URL}/api/predictions`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setPredictions(data.predictions);
      setGeneratedAt(data.generatedAt);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const leagues = ['all', ...new Set(predictions.map(p => p.league))];

  const filtered = predictions.filter(p => {
    if (activeLeague !== 'all' && p.league !== activeLeague) return false;
    if (activeConf === 'btts' && !(p.homeWillScore && p.awayWillScore)) return false;
    if (activeConf === 'vh' && p.confidence !== 'very-high') return false;
    if (activeConf === 'score' && !p.homeWillScore && !p.awayWillScore) return false;
    return true;
  });

  const stats = {
    total: filtered.length,
    btts: filtered.filter(p => p.homeWillScore && p.awayWillScore).length,
    vh: filtered.filter(p => p.confidence === 'very-high').length,
  };

  return (
    <div className="app">
      <div className="header">
        <div>
          <h1>Weekend goal predictions</h1>
          <p>Nectar analyses live data to predict which teams will score</p>
        </div>
        <button className="fetch-btn" onClick={fetchPredictions} disabled={loading}>
          {loading ? 'Analysing...' : predictions.length ? 'Refresh' : 'Generate Nectar predictions'}
        </button>
      </div>

      {generatedAt && (
        <p className="generated-at">
          Last generated: {new Date(generatedAt).toLocaleString()}
        </p>
      )}

      {error && <div className="error-box">{error}</div>}

      {predictions.length > 0 && (
        <>
          <div className="stats-row">
            <div className="stat-card"><span className="stat-label">Fixtures</span><span className="stat-val">{stats.total}</span></div>
            <div className="stat-card"><span className="stat-label">Both score</span><span className="stat-val">{stats.btts}</span></div>
            <div className="stat-card"><span className="stat-label">Very high</span><span className="stat-val">{stats.vh}</span></div>
          </div>

          <div className="filters">
            <div className="filter-group">
              <span className="filter-label">League</span>
              <div className="pills">
                {leagues.map(l => (
                  <button key={l} className={`pill ${activeLeague === l ? 'active' : ''}`}
                    onClick={() => setActiveLeague(l)}>
                    {l === 'all' ? 'All leagues' : l}
                  </button>
                ))}
              </div>
            </div>
            <div className="filter-group">
              <span className="filter-label">Prediction</span>
              <div className="pills">
                {[['all','All'],['score','Will score'],['btts','Both score'],['vh','Very high']].map(([k,v]) => (
                  <button key={k} className={`pill ${activeConf === k ? 'active' : ''}`}
                    onClick={() => setActiveConf(k)}>{v}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="fixtures-list">
            {filtered.map(p => <FixtureCard key={p.fixtureId} p={p} />)}
          </div>
        </>
      )}

      {!loading && predictions.length === 0 && !error && (
        <div className="empty-state">
          <p>Click "Generate predictions" to have Nectar analyse this weekend's fixtures</p>
        </div>
      )}
    </div>
  );
}