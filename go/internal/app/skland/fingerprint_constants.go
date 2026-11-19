// Code generated from ArkMowers/arknights-mower utils/SecuritySm.py (MIT). DO NOT EDIT.
package skland

type smConfigData struct {
	Organization string
	AppID        string
	PublicKey    string
	Protocol     string
	APIHost      string
}

var smConfig = smConfigData{
	Organization: "UWXspnCCJN4sfYlNfqps",
	AppID:        "default",
	PublicKey:    "MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCmxMNr7n8ZeT0tE1R9j/mPixoinPkeM+k4VGIn/s0k7N5rJAfnZ0eMER+QhwFvshzo0LNmeUkpR8uIlU/GEVr8mN28sKmwd2gpygqj0ePnBmOW4v0ZVwbSYK+izkhVFk2V/doLoMbWy6b+UnA8mkjvg0iYWRByfRsK2gdl7llqCwIDAQAB",
	Protocol:     "https",
	APIHost:      "fp-it.portal101.cn",
}

const sensebotDeviceURL = "https://fp-it.portal101.cn/deviceprofile/v4"

type browserKV struct {
	Key   string
	Value any
}

var browserEnv = []browserKV{
	{"plugins", "MicrosoftEdgePDFPluginPortableDocumentFormatinternal-pdf-viewer1,MicrosoftEdgePDFViewermhjfbmdgcfjbbpaeojofohoefgiehjai1"},
	{"ua", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0"},
	{"canvas", "259ffe69"},
	{"timezone", -480},
	{"platform", "Win32"},
	{"url", "https://www.skland.com/"},
	{"referer", ""},
	{"res", "1920_1080_24_1.25"},
	{"clientSize", "0_0_1080_1920_1920_1080_1920_1080"},
	{"status", "0011"},
}

type desRule struct {
	Field      string
	Encrypt    bool
	Key        string
	Obfuscated string
}

var desRules = map[string]desRule{
	"appId":        {Field: "appId", Encrypt: true, Key: "uy7mzc4h", Obfuscated: "xx"},
	"box":          {Field: "box", Encrypt: false, Key: "", Obfuscated: "jf"},
	"canvas":       {Field: "canvas", Encrypt: true, Key: "snrn887t", Obfuscated: "yk"},
	"clientSize":   {Field: "clientSize", Encrypt: true, Key: "cpmjjgsu", Obfuscated: "zx"},
	"organization": {Field: "organization", Encrypt: true, Key: "78moqjfc", Obfuscated: "dp"},
	"os":           {Field: "os", Encrypt: true, Key: "je6vk6t4", Obfuscated: "pj"},
	"platform":     {Field: "platform", Encrypt: true, Key: "pakxhcd2", Obfuscated: "gm"},
	"plugins":      {Field: "plugins", Encrypt: true, Key: "v51m3pzl", Obfuscated: "kq"},
	"pmf":          {Field: "pmf", Encrypt: true, Key: "2mdeslu3", Obfuscated: "vw"},
	"protocol":     {Field: "protocol", Encrypt: false, Key: "", Obfuscated: "protocol"},
	"referer":      {Field: "referer", Encrypt: true, Key: "y7bmrjlc", Obfuscated: "ab"},
	"res":          {Field: "res", Encrypt: true, Key: "whxqm2a7", Obfuscated: "hf"},
	"rtype":        {Field: "rtype", Encrypt: true, Key: "x8o2h2bl", Obfuscated: "lo"},
	"sdkver":       {Field: "sdkver", Encrypt: true, Key: "9q3dcxp2", Obfuscated: "sc"},
	"status":       {Field: "status", Encrypt: true, Key: "2jbrxxw4", Obfuscated: "an"},
	"subVersion":   {Field: "subVersion", Encrypt: true, Key: "eo3i2puh", Obfuscated: "ns"},
	"svm":          {Field: "svm", Encrypt: true, Key: "fzj3kaeh", Obfuscated: "qr"},
	"time":         {Field: "time", Encrypt: true, Key: "q2t3odsk", Obfuscated: "nb"},
	"timezone":     {Field: "timezone", Encrypt: true, Key: "1uv05lj5", Obfuscated: "as"},
	"tn":           {Field: "tn", Encrypt: true, Key: "x9nzj1bp", Obfuscated: "py"},
	"trees":        {Field: "trees", Encrypt: true, Key: "acfs0xo4", Obfuscated: "pi"},
	"ua":           {Field: "ua", Encrypt: true, Key: "k92crp1t", Obfuscated: "bj"},
	"url":          {Field: "url", Encrypt: true, Key: "y95hjkoo", Obfuscated: "cf"},
	"version":      {Field: "version", Encrypt: false, Key: "", Obfuscated: "version"},
	"vpw":          {Field: "vpw", Encrypt: true, Key: "r9924ab5", Obfuscated: "ca"},
}
