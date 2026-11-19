package skland

import (
	"crypto/hmac"
	"crypto/md5"
	"crypto/sha256"
	"encoding/hex"
	"strconv"
)

// signRequest mirrors ArkMowers/arknights-mower's generate_signature: the
// signed payload is path + query + timestamp + the four signing headers.
// The header JSON keeps the original key order (platform, timestamp, dId,
// vName); the server compares the exact string.
func signRequest(token, path, query string, timestamp int64) string {
	ts := strconv.FormatInt(timestamp, 10)
	header := `{"platform":"","timestamp":"` + ts + `","dId":"","vName":""}`
	payload := path + query + ts + header
	mac := hmac.New(sha256.New, []byte(token))
	mac.Write([]byte(payload))
	inner := hex.EncodeToString(mac.Sum(nil))
	sum := md5.Sum([]byte(inner))
	return hex.EncodeToString(sum[:])
}
