import { useEffect, useState } from 'react'

/** Loads data with loading/error state; `reload` re-runs the loader. */
export function useLoader<T>(
  loader: () => Promise<T>,
  deps: unknown[] = []
): {
  data: T | undefined
  error: string | null
  loading: boolean
  reload: () => Promise<void>
  setData: (d: T) => void
} {
  const [data, setData] = useState<T>()
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const reload = async (): Promise<void> => {
    setLoading(true)
    try {
      setData(await loader())
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    let alive = true
    loader()
      .then((d) => {
        if (!alive) return
        setData(d)
        setError(null)
      })
      .catch((e) => alive && setError((e as Error).message))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return { data, error, loading, reload, setData }
}
