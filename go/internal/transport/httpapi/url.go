package httpapi

import "net/url"

func newURL(source *url.URL) *url.URL {
	if source == nil {
		return &url.URL{}
	}
	copy := *source
	return &copy
}
