package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"time"

	"github.com/mps233/la-pluma/go/internal/infra/adb"
	"github.com/mps233/la-pluma/go/internal/infra/scrcpy"
)

func main() {
	var (
		adbPath = flag.String("adb", "/opt/homebrew/bin/adb", "adb executable")
		serial  = flag.String("serial", "127.0.0.1:16384", "device serial")
		server  = flag.String("server", "/tmp/scrcpy-server-v3.3.4", "scrcpy-server jar")
		version = flag.String("version", "3.3.4", "scrcpy server version")
		packets = flag.Int("packets", 60, "video packets to read")
		sendKey = flag.Bool("key", false, "send Home after the first packets")
		forward = flag.Bool("forward", false, "use adb forward instead of reverse")
		timeout = flag.Duration("timeout", 30*time.Second, "overall timeout")
	)
	flag.Parse()

	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	ctx, cancel := context.WithTimeout(context.Background(), *timeout)
	defer cancel()

	session := scrcpy.New(scrcpy.Options{
		ADB:           adb.New(*adbPath),
		Serial:        *serial,
		ServerPath:    *server,
		ServerVersion: *version,
		BitRate:       4_000_000,
		MaxSize:       1280,
		MaxFPS:        30,
		Control:       true,
		Audio:         false,
		TunnelForward: *forward,
		Logger:        logger,
	})
	if err := session.Start(ctx); err != nil {
		logger.Error("start", "error", err)
		os.Exit(1)
	}
	defer session.Close()
	fmt.Printf("VIDEO %dx%d codec=%08x\n", session.Width, session.Height, session.VideoHeader.Codec)

	configSeen := 0
	keySeen := 0
	bytesRead := 0
	for index := 1; index <= *packets; index++ {
		header, data, err := session.ReadVideoPacket()
		if err != nil {
			logger.Error("read packet", "index", index, "error", err)
			os.Exit(1)
		}
		if header.IsConfig() {
			configSeen++
		}
		if header.IsKeyFrame() {
			keySeen++
		}
		bytesRead += len(data)
		if index <= 5 || index%20 == 0 {
			fmt.Printf("PACKET %d size=%d pts=%d config=%v key=%v\n", index, len(data), header.PTS(), header.IsConfig(), header.IsKeyFrame())
		}
		if *sendKey && index == 10 {
			if err := session.SendKeyTap(scrcpy.KeycodeHome); err != nil {
				logger.Error("send home", "error", err)
				os.Exit(1)
			}
			fmt.Println("SENT keyevent HOME")
		}
	}
	fmt.Printf("DONE packets=%d config=%d key=%d bytes=%d\n", *packets, configSeen, keySeen, bytesRead)
}
