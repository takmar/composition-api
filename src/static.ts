import { onServerPrefetch, watch, computed, ref } from '@vue/composition-api'
import type { Ref } from '@vue/composition-api'

import { joinURL } from 'ufo'

import { ssrRef } from './ssr-ref'
import { globalContext } from './globals'

const staticPath = '<%= options.staticPath %>'
const staticCache: Record<string, any> = {}

function writeFile(key: string, value: string) {
  if (process.client || !process.static) return

  const { writeFileSync }: typeof import('fs') = process.client
    ? ''
    : require('fs')
  const { join }: typeof import('path') = process.client ? '' : require('path')

  try {
    writeFileSync(join(staticPath, `${key}.json`), value)
  } catch (e) {
    console.log(e)
  }
}
/**
 * You can pre-run expensive functions using `useStatic`. 
 * 
 * __SSG__
 * If you are generating the whole app (or just prerendering some routes with `nuxt build && nuxt generate --no-build`) the following behaviour will be unlocked:

    1. On generate, the result of a `useStatic` call will be saved to a JSON file and copied into the `/dist` directory.
    2. On hard-reload of a generated page, the JSON will be inlined into the page and cached.
    3. On client navigation to a generated page, this JSON will be fetched - and once fetched it will be cached for subsequent navigations. If for whatever reason this JSON doesn't exist, such as if the page *wasn't* pre-generated, the original factory function will be run on client-side.

  If you are pregenerating some pages in your app note that you may need to increase `generate.interval`. (See [setup instructions](https://composition-api.nuxtjs.org/setup.html).)

  * 
  * __SSR__
  * If the route is not pre-generated (including in dev mode), then:

    1. On a hard-reload, the server will run the factory function and inline the result in `nuxtState` - so the client won't rerun the API request. The result will be cached between requests.
    2. On client navigation, the client will run the factory function.

  In both of these cases, the return result of `useStatic` is a `null` ref that is filled with the result of the factory function or JSON fetch when it resolves.

 * @param factory The async function that will populate the ref this function returns. It receives the param and keyBase (see below) as parameters.
 * @param param A an optional param (such as an ID) to distinguish multiple API fetches using the same factory function.
 * @param keyBase A key that should be unique across your project. If not provided, this will be auto-generated by `@nuxtjs/composition-api`.
 * @example
  ```ts
  import { defineComponent, useContext, useStatic, computed } from '@nuxtjs/composition-api'
  import axios from 'axios'

  export default defineComponent({
    setup() {
      const { params } = useContext()
      const id = computed(() => params.value.id)
      const post = useStatic(
        id => axios.get(`https://jsonplaceholder.typicode.com/posts/${id}`),
        id,
        'post'
      )

      return { post }
    },
  })
  ```
 */
export const useStatic = <T>(
  factory: (param: string, key: string) => Promise<T>,
  param: Ref<string> = ref(''),
  keyBase: string
): Ref<T | null> => {
  const key = computed(() => `${keyBase}-${param.value}`)
  const result = ssrRef<T | null>(null, key.value)

  if (result.value) staticCache[key.value] = result.value

  if (process.client) {
    const publicPath =
      (window as any)[globalContext].$config?.app?.cdnURL ||
      '<%= options.publicPath %>'
    const onFailure = () =>
      factory(param.value, key.value).then(r => {
        staticCache[key.value] = r
        result.value = r
        return
      })
    watch(
      key,
      key => {
        if (key in staticCache) {
          result.value = staticCache[key]
          return
        }
        /* eslint-disable promise/always-return */
        if (!process.static) onFailure()
        else
          fetch(joinURL(publicPath, `${key}.json`))
            .then(response => {
              if (!response.ok) throw new Error('Response invalid.')
              return response.json()
            })
            .then(json => {
              staticCache[key] = json
              result.value = json
            })
            .catch(onFailure)
        /* eslint-enable */
      },
      {
        immediate: true,
      }
    )
  } else {
    if (key.value in staticCache) {
      result.value = staticCache[key.value]
      return result as Ref<T | null>
    }
    onServerPrefetch(async () => {
      const [_key, _param] = [key.value, param.value]

      result.value = await factory(_param, _key)
      staticCache[_key] = result.value
      writeFile(_key, JSON.stringify(result.value))
    })
  }

  return result as Ref<T | null>
}
