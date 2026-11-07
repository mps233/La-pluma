// Package scrcpy speaks the scrcpy server wire protocol over an ADB tunnel.
// It does not bundle or reimplement scrcpy itself: a pinned scrcpy-server jar
// is pushed to the device and launched through app_process. Video is H.264;
// audio is intentionally disabled in the first implementation.
package scrcpy

import (
	"encoding/binary"
	"fmt"
	"io"
)

const (
	// Video codec IDs.
	CodecH264 uint32 = 0x68323634 // "h264"
	CodecH265 uint32 = 0x68323635 // "h265"
	CodecAV1  uint32 = 0x00617631 // "av1"

	// Packet flag bits packed into the high bits of the PTS word.
	FlagConfig   uint64 = 1 << 63
	FlagKeyFrame uint64 = 1 << 62

	// Control message types (client -> device).
	CtrlInjectKeycode           byte = 0
	CtrlInjectText              byte = 1
	CtrlInjectTouchEvent        byte = 2
	CtrlInjectScrollEvent       byte = 3
	CtrlBackOrScreenOn          byte = 4
	CtrlExpandNotificationPanel byte = 5
	CtrlExpandSettingsPanel     byte = 6
	CtrlCollapsePanels          byte = 7
	CtrlGetClipboard            byte = 8
	CtrlSetClipboard            byte = 9
	CtrlSetDisplayPower         byte = 10
	CtrlRotateDevice            byte = 11

	// Android MotionEvent actions used by touch injection.
	TouchActionDown   = 0
	TouchActionUp     = 1
	TouchActionMove   = 2
	TouchActionCancel = 3

	// Android key actions.
	KeyActionDown = 0
	KeyActionUp   = 1

	// Common keycodes used by the existing UI.
	KeycodeHome      = 3
	KeycodeBack      = 4
	KeycodeAppSwitch = 187
)

type VideoHeader struct {
	Codec  uint32
	Width  uint32
	Height uint32
}

type PacketHeader struct {
	PTSAndFlags uint64
	Size        uint32
}

func (h PacketHeader) IsConfig() bool   { return h.PTSAndFlags&FlagConfig != 0 }
func (h PacketHeader) IsKeyFrame() bool { return h.PTSAndFlags&FlagKeyFrame != 0 }
func (h PacketHeader) PTS() uint64      { return h.PTSAndFlags &^ (FlagConfig | FlagKeyFrame) }

func ReadVideoHeader(r io.Reader) (VideoHeader, error) {
	var buffer [12]byte
	if _, err := io.ReadFull(r, buffer[:]); err != nil {
		return VideoHeader{}, fmt.Errorf("read video header: %w", err)
	}
	return VideoHeader{
		Codec:  binary.BigEndian.Uint32(buffer[0:4]),
		Width:  binary.BigEndian.Uint32(buffer[4:8]),
		Height: binary.BigEndian.Uint32(buffer[8:12]),
	}, nil
}

func ReadPacketHeader(r io.Reader) (PacketHeader, error) {
	var buffer [12]byte
	if _, err := io.ReadFull(r, buffer[:]); err != nil {
		return PacketHeader{}, err
	}
	return PacketHeader{
		PTSAndFlags: binary.BigEndian.Uint64(buffer[0:8]),
		Size:        binary.BigEndian.Uint32(buffer[8:12]),
	}, nil
}

func ReadPacket(r io.Reader) (PacketHeader, []byte, error) {
	header, err := ReadPacketHeader(r)
	if err != nil {
		return PacketHeader{}, nil, err
	}
	if header.Size > 64<<20 {
		return PacketHeader{}, nil, fmt.Errorf("scrcpy packet too large: %d", header.Size)
	}
	data := make([]byte, header.Size)
	if _, err := io.ReadFull(r, data); err != nil {
		return PacketHeader{}, nil, fmt.Errorf("read packet data: %w", err)
	}
	return header, data, nil
}

func WriteKeycode(w io.Writer, action, keycode, repeat, metaState int) error {
	var buffer [14]byte
	buffer[0] = CtrlInjectKeycode
	buffer[1] = byte(action)
	binary.BigEndian.PutUint32(buffer[2:6], uint32(keycode))
	binary.BigEndian.PutUint32(buffer[6:10], uint32(repeat))
	binary.BigEndian.PutUint32(buffer[10:14], uint32(metaState))
	_, err := w.Write(buffer[:])
	return err
}

func WriteTouch(w io.Writer, action int, pointerID uint64, x, y int32, width, height uint16, pressure float32, actionButton, buttons int) error {
	var buffer [32]byte
	buffer[0] = CtrlInjectTouchEvent
	buffer[1] = byte(action)
	binary.BigEndian.PutUint64(buffer[2:10], pointerID)
	binary.BigEndian.PutUint32(buffer[10:14], uint32(x))
	binary.BigEndian.PutUint32(buffer[14:18], uint32(y))
	binary.BigEndian.PutUint16(buffer[18:20], width)
	binary.BigEndian.PutUint16(buffer[20:22], height)
	binary.BigEndian.PutUint16(buffer[22:24], fixedU16(pressure))
	binary.BigEndian.PutUint32(buffer[24:28], uint32(actionButton))
	binary.BigEndian.PutUint32(buffer[28:32], uint32(buttons))
	_, err := w.Write(buffer[:])
	return err
}

func WriteScroll(w io.Writer, x, y int32, width, height uint16, hScroll, vScroll float32, buttons int) error {
	var buffer [21]byte
	buffer[0] = CtrlInjectScrollEvent
	binary.BigEndian.PutUint32(buffer[1:5], uint32(x))
	binary.BigEndian.PutUint32(buffer[5:9], uint32(y))
	binary.BigEndian.PutUint16(buffer[9:11], width)
	binary.BigEndian.PutUint16(buffer[11:13], height)
	binary.BigEndian.PutUint16(buffer[13:15], fixedI16(hScroll/16))
	binary.BigEndian.PutUint16(buffer[15:17], fixedI16(vScroll/16))
	binary.BigEndian.PutUint32(buffer[17:21], uint32(buttons))
	_, err := w.Write(buffer[:])
	return err
}

func WriteText(w io.Writer, text string) error {
	bytes := []byte(text)
	buffer := make([]byte, 5+len(bytes))
	buffer[0] = CtrlInjectText
	binary.BigEndian.PutUint32(buffer[1:5], uint32(len(bytes)))
	copy(buffer[5:], bytes)
	_, err := w.Write(buffer)
	return err
}

func WriteBackOrScreenOn(w io.Writer, action int) error {
	_, err := w.Write([]byte{CtrlBackOrScreenOn, byte(action)})
	return err
}

func WriteCollapsePanels(w io.Writer) error {
	_, err := w.Write([]byte{CtrlCollapsePanels})
	return err
}

func WriteExpandNotificationPanel(w io.Writer) error {
	_, err := w.Write([]byte{CtrlExpandNotificationPanel})
	return err
}

func WriteExpandSettingsPanel(w io.Writer) error {
	_, err := w.Write([]byte{CtrlExpandSettingsPanel})
	return err
}

func WriteRotateDevice(w io.Writer) error {
	_, err := w.Write([]byte{CtrlRotateDevice})
	return err
}

func fixedU16(value float32) uint16 {
	if value < 0 {
		value = 0
	}
	if value > 1 {
		value = 1
	}
	return uint16(value * 0xFFFF)
}

func fixedI16(value float32) uint16 {
	if value < -1 {
		value = -1
	}
	if value > 1 {
		value = 1
	}
	return uint16(int16(value * 0x7FFF))
}
