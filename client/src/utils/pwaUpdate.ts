const UPDATE_CHECK_QUERY = 'la-pluma-update-check'

type FetchDocument = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

const getDocumentBuildFingerprint = (sourceDocument: Document, baseUrl: string) => {
  const assets = Array.from(sourceDocument.querySelectorAll(
    'script[type="module"][src], link[rel="stylesheet"][href]',
  )).flatMap(element => {
    const attribute = element.tagName === 'SCRIPT' ? 'src' : 'href'
    const assetUrl = element.getAttribute(attribute)
    if (!assetUrl) return []

    try {
      return [new URL(assetUrl, baseUrl).href]
    } catch {
      return []
    }
  })

  return assets.length > 0 ? assets.sort().join('|') : null
}

export const createDocumentBuildCheck = (currentDocument: Document, appUrl: URL) => {
  const currentFingerprint = getDocumentBuildFingerprint(currentDocument, appUrl.href)

  return async (fetchDocument: FetchDocument = window.fetch.bind(window)) => {
    if (!currentFingerprint) return false

    const requestUrl = new URL(appUrl)
    requestUrl.searchParams.set(UPDATE_CHECK_QUERY, String(Date.now()))
    const response = await fetchDocument(requestUrl, {
      cache: 'no-store',
      credentials: 'same-origin',
      priority: 'low',
      headers: {
        'Cache-Control': 'no-cache',
      },
    })
    if (!response.ok) return false

    const latestDocument = new DOMParser().parseFromString(await response.text(), 'text/html')
    const latestFingerprint = getDocumentBuildFingerprint(
      latestDocument,
      response.url || requestUrl.href,
    )

    return latestFingerprint !== null && latestFingerprint !== currentFingerprint
  }
}
