package scrcpy

import (
	"bytes"
	"encoding/binary"
	"testing"
)

func TestReadVideoHeaderAndPacket(t *testing.T) {
	var header [12]byte
	binary.BigEndian.PutUint32(header[0:4], CodecH264)
	binary.BigEndian.PutUint32(header[4:8], 1280)
	binary.BigEndian.PutUint32(header[8:12], 720)
	parsed, err := ReadVideoHeader(bytes.NewReader(header[:]))
	if err != nil {
		t.Fatal(err)
	}
	if parsed.Codec != CodecH264 || parsed.Width != 1280 || parsed.Height != 720 {
		t.Fatalf("unexpected header: %+v", parsed)
	}

	payload := []byte{1, 2, 3, 4}
	packet := make([]byte, 12+len(payload))
	binary.BigEndian.PutUint64(packet[0:8], FlagConfig|FlagKeyFrame|12345)
	binary.BigEndian.PutUint32(packet[8:12], uint32(len(payload)))
	copy(packet[12:], payload)
	packetHeader, data, err := ReadPacket(bytes.NewReader(packet))
	if err != nil {
		t.Fatal(err)
	}
	if !packetHeader.IsConfig() || !packetHeader.IsKeyFrame() || packetHeader.PTS() != 12345 {
		t.Fatalf("unexpected packet flags: %+v", packetHeader)
	}
	if !bytes.Equal(data, payload) {
		t.Fatalf("unexpected payload: %v", data)
	}
}

func TestControlEncoding(t *testing.T) {
	var buffer bytes.Buffer
	if err := WriteTouch(&buffer, TouchActionDown, 7, 100, 200, 1280, 720, 1, 1, 1); err != nil {
		t.Fatal(err)
	}
	data := buffer.Bytes()
	if len(data) != 32 || data[0] != CtrlInjectTouchEvent || data[1] != TouchActionDown {
		t.Fatalf("unexpected touch: %x", data)
	}
	if binary.BigEndian.Uint64(data[2:10]) != 7 || binary.BigEndian.Uint32(data[10:14]) != 100 {
		t.Fatalf("unexpected touch coordinates: %x", data)
	}

	buffer.Reset()
	if err := WriteKeycode(&buffer, KeyActionDown, KeycodeBack, 0, 0); err != nil {
		t.Fatal(err)
	}
	if len(buffer.Bytes()) != 14 || buffer.Bytes()[0] != CtrlInjectKeycode {
		t.Fatalf("unexpected key: %x", buffer.Bytes())
	}

	buffer.Reset()
	if err := WriteText(&buffer, "你好"); err != nil {
		t.Fatal(err)
	}
	if buffer.Bytes()[0] != CtrlInjectText || binary.BigEndian.Uint32(buffer.Bytes()[1:5]) != 6 {
		t.Fatalf("unexpected text: %x", buffer.Bytes())
	}
}
