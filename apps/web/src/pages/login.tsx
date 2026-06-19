import { useState } from 'react'
import { Link } from 'react-router-dom'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Sign in to Photox</h1>
          <p className="mt-1 text-sm text-zinc-400">Personal photo &amp; video hosting</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="mb-1 block text-sm font-medium">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-medium">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            className="w-full rounded-lg bg-white px-4 py-2 text-sm font-medium text-black hover:bg-zinc-200"
          >
            Sign in
          </button>
        </form>

        <p className="text-center text-sm text-zinc-400">
          Don&apos;t have an account?{' '}
          <Link to="/register" className="text-white underline underline-offset-2 hover:text-zinc-300">
            Create one
          </Link>
        </p>
      </div>
    </div>
  )
}
