package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"net/http"
	"os"
	"time"

	"github.com/gorilla/websocket"
)

func main() {
	var (
		base    = flag.String("base", "http://127.0.0.1:9191", "probe base URL")
		command = flag.String("command", "input keyevent 3", "scrcpy/adb command")
		device  = flag.String("device", "mumu", "device id")
	)
	flag.Parse()

	login, err := http.Post(*base+"/api/login", "application/json", nil)
	if err != nil {
		fmt.Fprintln(os.Stderr, "login:", err)
		os.Exit(1)
	}
	defer login.Body.Close()
	var loginBody struct {
		Token string `json:"token"`
	}
	if err := json.NewDecoder(login.Body).Decode(&loginBody); err != nil || loginBody.Token == "" {
		fmt.Fprintln(os.Stderr, "login response invalid")
		os.Exit(1)
	}

	scheme := "ws://"
	host := (*base)[len("http://"):]
	if len(*base) >= len("https://") && (*base)[:len("https://")] == "https://" {
		scheme = "wss://"
		host = (*base)[len("https://"):]
	}
	wsURL := scheme + host + "/connect_client?token=" + loginBody.Token + "&deviceId=" + *device
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		fmt.Fprintln(os.Stderr, "ws:", err)
		os.Exit(1)
	}
	defer conn.Close()

	if _, data, err := conn.ReadMessage(); err != nil || !bytes.Contains(data, []byte(`"config"`)) {
		fmt.Fprintf(os.Stderr, "expected config, got %s err=%v\n", data, err)
		os.Exit(1)
	}
	if err := conn.WriteJSON(map[string]any{
		"message_type": "command",
		"device_id":    *device,
		"request_id":   "probe-1",
		"command":      *command,
	}); err != nil {
		fmt.Fprintln(os.Stderr, "write:", err)
		os.Exit(1)
	}
	_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	for {
		_, data, err := conn.ReadMessage()
		if err != nil {
			fmt.Fprintln(os.Stderr, "read:", err)
			os.Exit(1)
		}
		fmt.Println(string(data))
		var message struct {
			Payload struct {
				Type string `json:"type"`
			} `json:"payload"`
		}
		if json.Unmarshal(data, &message) == nil && message.Payload.Type == "command_result" {
			return
		}
	}
}
