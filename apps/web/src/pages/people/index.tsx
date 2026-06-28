import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { FaSpinner, FaUsers, FaFaceSmile } from 'react-icons/fa6'
import { RequireAuth } from '../../components/RequireAuth'
import { AppShell } from '../../components/AppShell'
import { listPersons, triggerCluster } from '../../api/persons'
import type { PersonDto } from '@photox/shared-types'

export default function PeoplePage() {
  const [persons, setPersons] = useState<PersonDto[]>([])
  const [loading, setLoading] = useState(true)
  const [clustering, setClustering] = useState(false)
  const [clusterMsg, setClusterMsg] = useState<string | null>(null)

  useEffect(() => {
    listPersons()
      .then((res) => setPersons(res.items))
      .catch(() => { /* ponytail: silent fail */ })
      .finally(() => setLoading(false))
  }, [])

  const handleCluster = async () => {
    setClustering(true)
    setClusterMsg(null)
    try {
      await triggerCluster()
      setClusterMsg('Clustering queued, refresh in a moment')
    } catch {
      setClusterMsg('Failed to queue clustering')
    } finally {
      setClustering(false)
    }
  }

  return (
    <RequireAuth>
      <AppShell>
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-2xl font-bold text-white">People</h1>
            <button
              onClick={() => { void handleCluster() }}
              disabled={clustering}
              className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/80 transition-colors disabled:opacity-50"
            >
              {clustering ? (
                <span className="inline-flex items-center gap-2">
                  <FaSpinner className="animate-spin" /> Clustering…
                </span>
              ) : (
                'Cluster faces'
              )}
            </button>
          </div>

          {clusterMsg && <p className="text-sm text-primary mb-4">{clusterMsg}</p>}

          {loading ? (
            <div className="flex justify-center py-20">
              <FaSpinner className="text-primary text-2xl animate-spin" />
            </div>
          ) : persons.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <FaUsers className="text-4xl text-slate-500 mb-4" />
              <p className="text-slate-400 text-lg mb-4">No people found</p>
              <button
                onClick={() => { void handleCluster() }}
                disabled={clustering}
                className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/80 transition-colors disabled:opacity-50"
              >
                Cluster faces
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
              {persons.map((person) => (
                <Link
                  key={person.id}
                  to={`/people/${person.id}`}
                  className="group flex flex-col items-center rounded-xl overflow-hidden bg-card-dark border border-border-dark hover:border-primary/50 transition-colors"
                >
                  <div className="w-full aspect-square bg-slate-800 flex items-center justify-center overflow-hidden">
                    {person.coverFaceUrl ? (
                      <img
                        src={person.coverFaceUrl}
                        alt={person.name ?? person.clusterLabel ?? 'Person'}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="flex flex-col items-center gap-1">
                        <FaFaceSmile className="text-3xl text-slate-500" />
                        {person.clusterLabel && (
                          <span className="text-[10px] text-slate-500">{person.clusterLabel}</span>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="w-full px-3 py-2 text-center">
                    <p className="text-sm text-white truncate">{person.name ?? 'Unknown'}</p>
                    <p className="text-xs text-slate-400">
                      {person.faceCount} {person.faceCount === 1 ? 'face' : 'faces'}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </AppShell>
    </RequireAuth>
  )
}
