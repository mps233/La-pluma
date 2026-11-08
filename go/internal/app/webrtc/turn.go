package webrtc

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net"
	"os"
	"strconv"
	"strings"

	"github.com/pion/turn/v5"
)

const (
	defaultTURNPort = 3478
	turnRealm       = "la-pluma"
)

type turnCredentials struct {
	port     int
	publicIP net.IP
	username string
	password string
}

// ensureTURN starts an embedded TURN/STUN server once. A port bind failure is
// non-fatal: the preview falls back to host candidates and the signaling
// config advertises no TURN servers.
func (s *Service) ensureTURN() {
	s.turnMu.Lock()
	defer s.turnMu.Unlock()
	if s.turnServer != nil && s.turnCredentials != nil {
		return
	}
	if strings.TrimSpace(os.Getenv("LA_PLUMA_WEBRTC_TURN_DISABLED")) == "1" {
		return
	}
	port := defaultTURNPort
	if raw := strings.TrimSpace(os.Getenv("LA_PLUMA_WEBRTC_TURN_PORT")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 && parsed < 65536 {
			port = parsed
		}
	}
	username := strings.TrimSpace(os.Getenv("LA_PLUMA_WEBRTC_TURN_USERNAME"))
	if username == "" {
		username = "la-pluma"
	}
	password := strings.TrimSpace(os.Getenv("LA_PLUMA_WEBRTC_TURN_PASSWORD"))
	if password == "" {
		var buffer [16]byte
		if _, err := rand.Read(buffer[:]); err == nil {
			password = hex.EncodeToString(buffer[:])
		} else {
			password = "la-pluma-turn"
		}
	}
	publicIP := net.ParseIP(strings.TrimSpace(os.Getenv("LA_PLUMA_WEBRTC_TURN_PUBLIC_IP")))
	if publicIP == nil {
		publicIP = localIPv4()
	}
	if publicIP == nil {
		s.logger.Warn("TURN 未启动：找不到局域网 IPv4 地址")
		return
	}

	listener, err := net.ListenPacket("udp4", fmt.Sprintf("0.0.0.0:%d", port))
	if err != nil {
		s.logger.Warn("TURN 未启动：UDP 端口不可用", "port", port, "error", err)
		return
	}
	authKey := turn.GenerateAuthKey(username, turnRealm, password)
	server, err := turn.NewServer(turn.ServerConfig{
		Realm: turnRealm,
		AuthHandler: func(attributes *turn.RequestAttributes) (string, []byte, bool) {
			if attributes.Username != username {
				return "", nil, false
			}
			return username, authKey, true
		},
		PacketConnConfigs: []turn.PacketConnConfig{{
			PacketConn: listener,
			RelayAddressGenerator: &turn.RelayAddressGeneratorStatic{
				RelayAddress: publicIP,
				Address:      "0.0.0.0",
			},
		}},
	})
	if err != nil {
		_ = listener.Close()
		s.logger.Warn("TURN 启动失败", "port", port, "error", err)
		return
	}
	s.turnServer = server
	s.turnCredentials = &turnCredentials{port: port, publicIP: publicIP, username: username, password: password}
	s.logger.Info("TURN 已启动", "port", port, "public_ip", publicIP.String())
}

// ICEServers returns the signaling config's ICE server list.
func (s *Service) ICEServers() []any {
	s.mu.Lock()
	running := s.current != nil
	s.mu.Unlock()
	if running {
		s.ensureTURN()
	}
	s.turnMu.Lock()
	server := s.turnServer
	credentials := s.turnCredentials
	s.turnMu.Unlock()
	if server == nil || credentials == nil {
		return []any{}
	}
	host := net.JoinHostPort(credentials.publicIP.String(), strconv.Itoa(credentials.port))
	return []any{map[string]any{
		"urls":       []string{"turn:" + host + "?transport=udp", "stun:" + host},
		"username":   credentials.username,
		"credential": credentials.password,
	}}
}

func (s *Service) stopTURN() {
	s.turnMu.Lock()
	server := s.turnServer
	s.turnServer = nil
	s.turnCredentials = nil
	s.turnMu.Unlock()
	if server != nil {
		_ = server.Close()
	}
}

func localIPv4() net.IP {
	interfaces, err := net.Interfaces()
	if err != nil {
		return nil
	}
	for _, iface := range interfaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		addresses, err := iface.Addrs()
		if err != nil {
			continue
		}
		for _, address := range addresses {
			var ip net.IP
			switch value := address.(type) {
			case *net.IPNet:
				ip = value.IP
			case *net.IPAddr:
				ip = value.IP
			}
			if ip == nil || ip.IsLoopback() || ip.To4() == nil {
				continue
			}
			return ip
		}
	}
	return nil
}
