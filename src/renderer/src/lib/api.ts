import { useEffect, useRef } from 'react'
import type {
  IpcChannel,
  IpcEnvelope,
  IpcEvent,
  IpcEvents,
  IpcPayload,
  IpcResultData
} from '../../../shared/ipc'

type Args<C extends IpcChannel> = IpcPayload<C> extends void ? [] : [IpcPayload<C>]

/** Typed request to the main process. Throws with the main-process error message on failure. */
export async function call<C extends IpcChannel>(
  channel: C,
  ...args: Args<C>
): Promise<IpcResultData<C>> {
  if (!window.pulse) throw new Error('PulseApply bridge unavailable')
  const res = (await window.pulse.invoke(channel, args[0])) as IpcEnvelope<IpcResultData<C>>
  if (!res.ok) throw new Error(res.error)
  return res.data
}

/** Subscribes to a main-process event for the lifetime of the component (always cleaned up). */
export function useEvent<E extends IpcEvent>(
  event: E,
  handler: (payload: IpcEvents[E]) => void
): void {
  const ref = useRef(handler)
  useEffect(() => {
    ref.current = handler
  })
  useEffect(() => {
    if (!window.pulse) return
    return window.pulse.on(event, (p) => ref.current(p as IpcEvents[E]))
  }, [event])
}
