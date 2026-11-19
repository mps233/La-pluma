package skland

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/des"
	"crypto/md5"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
)

// sensebotDeviceID ports ArkMowers/arknights-mower's SecuritySm.get_d_id
// (MIT). It returns the "B..." device id required by the Hypergryph login
// endpoints. The protocol is third-party and may change without notice.
func sensebotDeviceID(ctx context.Context, httpClient *http.Client) (string, error) {
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 20 * time.Second}
	}
	uid := newUUID()
	priID := md5Hex(uid)[:16]
	publicKey, err := parseSensebotPublicKey()
	if err != nil {
		return "", err
	}
	encryptedUID, err := rsa.EncryptPKCS1v15(rand.Reader, publicKey, []byte(uid))
	if err != nil {
		return "", err
	}
	target := buildSensebotTarget(uid)
	desTarget := encryptSensebotTarget(target)
	gzipped := gzipBytes([]byte(orderedJSON(desTarget)))
	payload := aesCBCEncryptHex([]byte(priID), gzipped)
	body := map[string]any{
		"appId":        "default",
		"compress":     2,
		"data":         payload,
		"encode":       5,
		"ep":           base64.StdEncoding.EncodeToString(encryptedUID),
		"organization": smConfig.Organization,
		"os":           "web",
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, sensebotDeviceURL, bytes.NewReader(raw))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "Mozilla/5.0")
	resp, err := httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("sensebot: %w", err)
	}
	defer resp.Body.Close()
	var result struct {
		Code   int `json:"code"`
		Detail struct {
			DeviceID string `json:"deviceId"`
		} `json:"detail"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("sensebot decode: %w", err)
	}
	if result.Code != 1100 || result.Detail.DeviceID == "" {
		return "", fmt.Errorf("sensebot rejected device profile (code %d)", result.Code)
	}
	return "B" + result.Detail.DeviceID, nil
}

func parseSensebotPublicKey() (*rsa.PublicKey, error) {
	der, err := base64.StdEncoding.DecodeString(smConfig.PublicKey)
	if err != nil {
		return nil, err
	}
	if parsed, err := x509.ParsePKIXPublicKey(der); err == nil {
		if key, ok := parsed.(*rsa.PublicKey); ok {
			return key, nil
		}
	}
	key, err := x509.ParsePKCS1PublicKey(der)
	if err != nil {
		return nil, err
	}
	return key, nil
}

func buildSensebotTarget(uid string) []browserKV {
	return buildSensebotTargetAt(uid, time.Now(), newUUID(), newUUID())
}

func buildSensebotTargetAt(uid string, now time.Time, vpw, trees string) []browserKV {
	target := make([]browserKV, 0, len(browserEnv)+16)
	target = append(target, browserEnv...)
	target = append(target,
		browserKV{"vpw", vpw},
		browserKV{"svm", now.UnixMilli()},
		browserKV{"trees", trees},
		browserKV{"pmf", now.UnixMilli()},
		browserKV{"protocol", 102},
		browserKV{"organization", smConfig.Organization},
		browserKV{"appId", smConfig.AppID},
		browserKV{"os", "web"},
		browserKV{"version", "3.0.0"},
		browserKV{"sdkver", "3.0.0"},
		browserKV{"box", ""},
		browserKV{"rtype", "all"},
		browserKV{"smid", sensebotSMIDAt(uid, now)},
		browserKV{"subVersion", "1.0.0"},
		browserKV{"time", 0},
	)
	target = append(target, browserKV{"tn", sensebotTN(target)})
	return target
}

func sensebotTN(target []browserKV) string {
	order := make([]int, len(target))
	for index := range order {
		order[index] = index
	}
	sort.SliceStable(order, func(i, j int) bool {
		return target[order[i]].Key < target[order[j]].Key
	})
	var builder strings.Builder
	for _, index := range order {
		switch value := target[index].Value.(type) {
		case int:
			builder.WriteString(strconv.Itoa(value * 10000))
		case int64:
			builder.WriteString(strconv.FormatInt(value*10000, 10))
		case string:
			builder.WriteString(value)
		default:
			builder.WriteString(fmt.Sprint(value))
		}
	}
	return md5Hex(builder.String())
}

func sensebotSMID(uid string) string {
	return sensebotSMIDAt(uid, time.Now())
}

func sensebotSMIDAt(uid string, now time.Time) string {
	prefix := fmt.Sprintf("%04d%02d%02d%02d%02d%02d", now.Year(), int(now.Month()), now.Day(), now.Hour(), now.Minute(), now.Second())
	value := prefix + md5Hex(uid) + "00"
	smsk := md5Hex("smsk_web_" + value)[:14]
	return value + smsk + "0"
}

func encryptSensebotTarget(target []browserKV) []browserKV {
	result := make([]browserKV, 0, len(target))
	for _, entry := range target {
		rule, ok := desRules[entry.Key]
		if !ok {
			result = append(result, entry)
			continue
		}
		if !rule.Encrypt {
			result = append(result, browserKV{rule.Obfuscated, entry.Value})
			continue
		}
		encrypted := desECBEncrypt([]byte(rule.Key), []byte(fmt.Sprint(entry.Value)))
		result = append(result, browserKV{rule.Obfuscated, base64.StdEncoding.EncodeToString(encrypted)})
	}
	return result
}

func desECBEncrypt(key, plain []byte) []byte {
	block, err := des.NewCipher(key)
	if err != nil {
		return nil
	}
	data := append(append([]byte{}, plain...), make([]byte, 8)...)
	size := len(data) / 8 * 8
	out := make([]byte, size)
	for index := 0; index < size; index += 8 {
		block.Encrypt(out[index:index+8], data[index:index+8])
	}
	return out
}

func orderedJSON(entries []browserKV) string {
	var builder strings.Builder
	builder.WriteByte('{')
	for index, entry := range entries {
		if index > 0 {
			builder.WriteString(", ")
		}
		builder.WriteString(pyJSONString(entry.Key))
		builder.WriteString(": ")
		switch value := entry.Value.(type) {
		case string:
			builder.WriteString(pyJSONString(value))
		case int:
			builder.WriteString(strconv.Itoa(value))
		case int64:
			builder.WriteString(strconv.FormatInt(value, 10))
		case float64:
			builder.WriteString(strconv.FormatFloat(value, 'f', -1, 64))
		case bool:
			builder.WriteString(strconv.FormatBool(value))
		default:
			builder.WriteString(pyJSONString(fmt.Sprint(value)))
		}
	}
	builder.WriteByte('}')
	return builder.String()
}

func pyJSONString(value string) string {
	var buffer bytes.Buffer
	encoder := json.NewEncoder(&buffer)
	encoder.SetEscapeHTML(false)
	_ = encoder.Encode(value)
	return strings.TrimSuffix(buffer.String(), "\n")
}

// gzipBytes mirrors SecuritySm.GZIP: the compressed bytes are base64 encoded
// before AES encryption, not encrypted as raw gzip.
func gzipBytes(data []byte) []byte {
	var buffer bytes.Buffer
	writer, err := gzip.NewWriterLevel(&buffer, 2)
	if err != nil {
		return nil
	}
	writer.Header.ModTime = time.Time{}
	_, _ = writer.Write(data)
	_ = writer.Close()
	encoded := base64.StdEncoding.EncodeToString(buffer.Bytes())
	return []byte(encoded)
}

func aesCBCEncryptHex(key, plain []byte) string {
	block, err := aes.NewCipher(key)
	if err != nil {
		return ""
	}
	iv := []byte("0102030405060708")
	data := append(append([]byte{}, plain...), 0)
	for len(data)%aes.BlockSize != 0 {
		data = append(data, 0)
	}
	out := make([]byte, len(data))
	cipher.NewCBCEncrypter(block, iv).CryptBlocks(out, data)
	return hex.EncodeToString(out)
}

func newUUID() string {
	var bytes [16]byte
	if _, err := io.ReadFull(rand.Reader, bytes[:]); err != nil {
		return ""
	}
	bytes[6] = (bytes[6] & 0x0f) | 0x40
	bytes[8] = (bytes[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", bytes[0:4], bytes[4:6], bytes[6:8], bytes[8:10], bytes[10:16])
}

func md5Hex(value string) string {
	sum := md5.Sum([]byte(value))
	return hex.EncodeToString(sum[:])
}
