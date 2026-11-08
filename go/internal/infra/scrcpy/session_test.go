package scrcpy

import (
	"bufio"
	"context"
	"encoding/binary"
	"fmt"
	"io"
	"net"
	"testing"
	"time"
)

func TestSendTouchCancelWritesActionUp(t *testing.T) {
	server, client := net.Pipe()
	defer server.Close()
	defer client.Close()
	session := &Session{ctrlConn: client}

	done := make(chan error, 1)
	go func() {
		done <- session.SendTouch(TouchActionCancel, 7, 12, 34, 1280, 720, 1)
	}()

	buffer := make([]byte, 32)
	if _, err := io.ReadFull(server, buffer); err != nil {
		t.Fatal(err)
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if buffer[0] != CtrlInjectTouchEvent || buffer[1] != TouchActionUp {
		t.Fatalf("touch packet = %x", buffer[:2])
	}
}

func TestSendScrollWritesControlPacket(t *testing.T) {
	server, client := net.Pipe()
	defer server.Close()
	defer client.Close()
	session := &Session{ctrlConn: client}

	done := make(chan error, 1)
	go func() {
		done <- session.SendScroll(12, 34, 1280, 720, 16, -16, 0)
	}()

	buffer := make([]byte, 21)
	if _, err := io.ReadFull(server, buffer); err != nil {
		t.Fatal(err)
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if buffer[0] != CtrlInjectScrollEvent {
		t.Fatalf("scroll packet type = %d", buffer[0])
	}
}

func TestSetClipboardWritesControlPacket(t *testing.T) {
	server, client := net.Pipe()
	defer server.Close()
	defer client.Close()
	session := &Session{ctrlConn: client}

	done := make(chan error, 1)
	go func() {
		done <- session.SetClipboard(context.Background(), "hello", true)
	}()

	buffer := make([]byte, 14+5)
	if _, err := io.ReadFull(server, buffer); err != nil {
		t.Fatal(err)
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if buffer[0] != CtrlSetClipboard || buffer[9] != 1 {
		t.Fatalf("clipboard packet = %x", buffer[:14])
	}
	if length := binary.BigEndian.Uint32(buffer[10:14]); length != 5 {
		t.Fatalf("clipboard length = %d", length)
	}
	if string(buffer[14:]) != "hello" {
		t.Fatalf("clipboard text = %q", buffer[14:])
	}
}

func TestGetClipboardWaitsForDeviceMessage(t *testing.T) {
	server, client := net.Pipe()
	defer server.Close()
	defer client.Close()
	session := &Session{ctrlConn: client, clipboardCh: make(chan struct{}, 1)}
	go session.readControlLoop(bufio.NewReader(client))

	serverErr := make(chan error, 1)
	go func() {
		request := make([]byte, 2)
		if _, err := io.ReadFull(server, request); err != nil {
			serverErr <- err
			return
		}
		if request[0] != CtrlGetClipboard {
			serverErr <- fmt.Errorf("request type = %d", request[0])
			return
		}
		message := []byte{DeviceMsgClipboard, 0, 0, 0, 5}
		message = append(message, []byte("hello")...)
		_, err := server.Write(message)
		serverErr <- err
	}()

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	text, err := session.GetClipboard(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if text != "hello" {
		t.Fatalf("clipboard = %q", text)
	}
	if err := <-serverErr; err != nil {
		t.Fatal(err)
	}
}
