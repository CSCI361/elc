import { lazy, useState, type ComponentType } from "react"

const preloaders: (() => Promise<unknown>)[] = []

export function preloadedPage<P extends object>(
  load: () => Promise<ComponentType<P>>
): ComponentType<P> {
  let loaded: ComponentType<P> | undefined
  let pending: Promise<ComponentType<P>> | undefined
  const preload = () =>
    (pending ??= load().then(
      (component) => (loaded = component),
      (error: unknown) => {
        pending = undefined
        throw error
      }
    ))
  const Lazy = lazy(() =>
    preload().then((component) => ({ default: component }))
  )
  preloaders.push(preload)
  return function Page(props: P) {
    const [Component] = useState<ComponentType<P>>(() => loaded ?? Lazy)
    return <Component {...props} />
  }
}

export function preloadPages(): Promise<unknown> {
  return Promise.allSettled(preloaders.map((preload) => preload()))
}
