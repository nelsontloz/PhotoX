import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { FaSpinner, FaUsers, FaFaceSmile } from 'react-icons/fa6'
import { RequireAuth } from '../../components/RequireAuth'
import { AppShell } from '../../components/AppShell'
import { listPersons } from '../../api/persons'
import type { PersonDto } from '@photox/shared-types'

export default function PeoplePage() {
  const [persons, setPersons] = useState<PersonDto[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    listPersons()
      .then((res) => setPersons(res.items))
      .catch(() => {
        /* ponytail: silent fail */
      })
      .finally(() => setLoading(false))
  }, [])

  return (
    <RequireAuth>
      <AppShell>
        <div className="max-w-6xl mx-auto">
          <h1 className="text-2xl font-bold text-white mb-6">People</h1>

          {loading ? (
            <div className="flex justify-center py-20">
              <FaSpinner className="text-primary text-2xl animate-spin" />
            </div>
          ) : persons.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <FaUsers className="text-4xl text-slate-500 mb-4" />
              <p className="text-slate-400 text-lg">No people found</p>
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
