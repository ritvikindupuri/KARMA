import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useWebSocket } from './hooks/useWebSocket'
import { Dashboard } from './components/Dashboard'
import { RemediationPanel } from './components/RemediationPanel'

type Tab = 'dashboard' | 'remediation'

const WS_URL = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`

export default function App() {
  const { connected, send, on } = useWebSocket(WS_URL)
  const [activeTab, setActiveTab] = useState<Tab>('dashboard')
  const [events, setEvents] = useState<any[]>([])
  const [clusterInfo, setClusterInfo] = useState<any>(null)
  const [attackHistory, setAttackHistory] = useState<any[]>([])
  const [detectionEvents, setDetectionEvents] = useState<any[]>([])
  const [infrastructureItems, setInfrastructureItems] = useState<any[]>([])
  const [remediationReady, setRemediationReady] = useState(false)
  const [remediationSessions, setRemediationSessions] = useState<any[]>([])
  const [orchestratorStatus, setOrchestratorStatus] = useState<any>(null)
  const [mitreAttack, setMitreAttack] = useState<any>(null)
  const eventsRef = useRef<any[]>([])

  useEffect(() => {
    let cancelled = false
    const fetchMitre = async () => {
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          const res = await fetch('/api/attacks/mitre')
          const d = await res.json()
          if (d?.mitre_attack && !cancelled) {
            setMitreAttack(d.mitre_attack)
            return
          }
        } catch {}
        await new Promise(r => setTimeout(r, 1000))
      }
    }
    fetchMitre()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const unsub = on('*', (data) => {
      const event = { ...data, receivedAt: Date.now() }
      eventsRef.current = [event, ...eventsRef.current].slice(0, 200)
      setEvents([...eventsRef.current])

      if (data.type === 'cluster_info') setClusterInfo(data.data)
      if (data.type === 'attack_event') {
        setAttackHistory(prev => {
          const exists = prev.findIndex(a => a.attack_id === data.attack_id)
          if (exists >= 0) {
            const updated = [...prev]
            const events = updated[exists].events || []
            updated[exists] = { ...updated[exists], events: [...events, data.event] }
            return updated
          }
          return prev
        })
      }
      if (data.type === 'attack_completed') {
        const attack = data.attack
        const matchId = attack.attack_id || attack.id
        setAttackHistory(prev => {
          const exists = prev.findIndex(a => a.attack_id === matchId)
          if (exists >= 0) {
            const updated = [...prev]
            const resultEvents = attack.result?.events || []
            updated[exists] = { ...updated[exists], ...attack, attack_id: matchId, status: attack.status, events: resultEvents }
            return updated
          }
          return [{ ...attack, attack_id: matchId, events: attack.result?.events || [] }, ...prev].slice(0, 50)
        })
      }
      if (data.type === 'attack_started') {
        const matchId = data.attack.attack_id || data.attack.id
        setAttackHistory(prev => {
          const exists = prev.findIndex(a => a.attack_id === matchId)
          if (exists >= 0) {
            const updated = [...prev]
            updated[exists] = { ...updated[exists], status: 'running', events: [] }
            return updated
          }
          return [{ ...data.attack, attack_id: matchId, events: [] }, ...prev].slice(0, 50)
        })
      }
      if (data.type === 'attack_failed') {
        const matchId = data.attack?.attack_id || data.attack?.id
        setAttackHistory(prev => {
          const exists = prev.findIndex(a => a.attack_id === matchId)
          if (exists >= 0) {
            const updated = [...prev]
            updated[exists] = { ...updated[exists], status: 'failed' }
            return updated
          }
          return prev
        })
      }
      if (data.type === 'infrastructure_affected') {
        setInfrastructureItems(prev => [data.infrastructure, ...prev].slice(0, 100))
      }
      if (data.type === 'detection_alert') {
        setDetectionEvents(prev => [data.data, ...prev].slice(0, 100))
      }
      if (data.type === 'orchestrator_started') {
        setOrchestratorStatus({ status: 'running', total: data.total_attacks, current: 0 })
      }
      if (data.type === 'orchestrator_completed') {
        setOrchestratorStatus({ status: 'completed', ...data })
      }
      if (data.type === 'remediation_started' && data.session) {
        setRemediationSessions(prev => {
          const exists = prev.find(s => s.session_id === data.session.session_id)
          if (exists) return prev
          return [data.session, ...prev].slice(0, 20)
        })
      }
      if (data.type === 'remediation_completed' && data.session_id) {
        setRemediationSessions(prev =>
          prev.map(s => s.session_id === data.session_id
            ? { ...s, status: 'completed', summary: data.summary }
            : s
          )
        )
      }
    })
    return () => unsub()
  }, [on])

  const fetchApi = useCallback(async (path: string) => {
    try {
      const res = await fetch(path)
      return await res.json()
    } catch { return null }
  }, [])

  // No pre-population — everything starts clean

  const activeRemediationCount = remediationSessions.filter(
    s => s.status === 'running' || s.status === 'pending'
  ).length

  return (
    <div style={{ minHeight: '100vh', background: '#0a0e17', color: '#e0e0e0' }}>
      <header style={{
        background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
        borderBottom: '1px solid #1e293b', padding: '8px 24px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 28, height: 28, flexShrink: 0 }}>
            {/* KARMA "Twin Helm" mark: a Kubernetes heptagon formed by two segments (attack / fix) around the cluster core */}
            <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="KARMA">
              <defs>
                <linearGradient id="karmaHelmA" gradientUnits="userSpaceOnUse" x1="30" y1="95" x2="70" y2="5">
                  <stop offset="0" stopColor="#12307a"/><stop offset="1" stopColor="#326ce5"/>
                </linearGradient>
                <linearGradient id="karmaHelmB" gradientUnits="userSpaceOnUse" x1="70" y1="95" x2="30" y2="5">
                  <stop offset="0" stopColor="#326ce5"/><stop offset="1" stopColor="#22d3ee"/>
                </linearGradient>
                <linearGradient id="karmaHelmCore" gradientUnits="userSpaceOnUse" x1="50" y1="38" x2="50" y2="62">
                  <stop offset="0" stopColor="#1e40af"/><stop offset="1" stopColor="#3b82f6"/>
                </linearGradient>
              </defs>
              <polyline points="71.67,24.44 78.15,27.55 85.10,58.01 65.62,82.43 41.25,82.43" fill="none" stroke="url(#karmaHelmA)" strokeWidth="12.5" strokeLinejoin="miter" strokeMiterlimit="8"/>
              <polyline points="29.12,75.84 14.90,58.01 21.85,27.55 50.00,14.00 57.88,17.80" fill="none" stroke="url(#karmaHelmB)" strokeWidth="12.5" strokeLinejoin="miter" strokeMiterlimit="8"/>
              <polygon points="55.21,39.19 61.70,47.33 59.38,57.48 50.00,62.00 40.62,57.48 38.30,47.33 44.79,39.19" fill="url(#karmaHelmCore)"/>
            </svg>
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>K8s Attack Platform</h1>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 1 }}>
              <span style={{ fontSize: 10, color: connected ? '#22c55e' : '#ef4444' }}>
                {connected ? '● Connected' : '○ Disconnected'}
              </span>
              {remediationReady && (
                <span style={{ fontSize: 9, color: '#8b5cf6', background: '#1e1b4b', padding: '1px 6px', borderRadius: 3, border: '1px solid #4c1d95' }}>
                  AI Ready
                </span>
              )}
              {activeRemediationCount > 0 && (
                <span style={{ fontSize: 9, color: '#f97316', background: '#431407', padding: '1px 6px', borderRadius: 3 }}>
                  {activeRemediationCount} active
                </span>
              )}
            </div>
          </div>
        </div>
        <nav style={{ display: 'flex', gap: 2 }}>
          {[
            { id: 'dashboard' as Tab, label: 'Dashboard' },
            { id: 'remediation' as Tab, label: 'AI Remediation' },
          ].map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
              padding: '5px 14px', fontSize: 11, borderRadius: 6,
              cursor: 'pointer', fontWeight: 600,
              background: activeTab === t.id
                ? (t.id === 'remediation' ? '#3b0764' : '#334155')
                : (t.id === 'remediation' ? 'rgba(139, 92, 246, 0.08)' : 'transparent'),
              color: activeTab === t.id
                ? (t.id === 'remediation' ? '#c4b5fd' : '#fff')
                : (t.id === 'remediation' ? '#a78bfa' : '#64748b'),
              border: t.id === 'remediation' ? '1px solid rgba(139, 92, 246, 0.25)' : 'none',
              transition: 'all 0.15s',
            }}>{t.label}</button>
          ))}
        </nav>
      </header>

      <main style={{ padding: 16, maxWidth: 1440, margin: '0 auto' }}>
        {activeTab === 'dashboard' && (
          <Dashboard
            clusterInfo={clusterInfo}
            attackHistory={attackHistory}
            detectionEvents={detectionEvents}
            infrastructureItems={infrastructureItems}
            orchestratorStatus={orchestratorStatus}
            events={events}
            send={send}
            fetchApi={fetchApi}
            remediationReady={remediationReady}
            remediationSessions={remediationSessions}
            mitreAttack={mitreAttack}
          />
        )}
        {activeTab === 'remediation' && (
          <RemediationPanel events={events} fetchApi={fetchApi} send={send} remediationSessions={remediationSessions} />
        )}
      </main>
    </div>
  )
}
