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
	// scrcpy v5 added the session flag and shifted config/key-frame down.
	FlagSession  uint64 = 1 << 63
	FlagConfig   uint64 = 1 << 62
	FlagKeyFrame uint64 = 1 << 61
	// PTSMask masks off all flag bits; PTS uses the lower 61 bits.
	PTSMask uint64 = FlagKeyFrame - 1

	// Control message types (client -> device).
	CtrlInjectKeycode     byte = 0
	CtrlInjectText        byte = 1
	CtrlInjectTouchEvent  byte = 2
	CtrlInjectScrollEvent byte = 3

	CtrlGetClipboard    byte = 8
	CtrlSetClipboard    byte = 9
	CtrlSetDisplayPower byte = 10

	CtrlResetVideo byte = 17

	// Device-to-client message types.
	DeviceMsgClipboard    byte = 0
	DeviceMsgAckClipboard byte = 1

	// MaxClipboardBytes matches scrcpy's clipboard payload limit.
	MaxClipboardBytes = 262130

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

// VideoHeader is the stream header scrcpy v5 sends before the first frame:
// a 4-byte codec id followed by a session packet carrying the frame size.
type VideoHeader struct {
	Codec  uint32
	Width  uint32
	Height uint32
}

type PacketHeader struct {
	PTSAndFlags uint64
	Size        uint32
}

func (h PacketHeader) IsSession() bool  { return h.PTSAndFlags&FlagSession != 0 }
func (h PacketHeader) IsConfig() bool   { return h.PTSAndFlags&FlagConfig != 0 }
func (h PacketHeader) IsKeyFrame() bool { return h.PTSAndFlags&FlagKeyFrame != 0 }
func (h PacketHeader) PTS() uint64      { return h.PTSAndFlags & PTSMask }

// readCodecID reads the leading codec id of a v5 stream.
func ReadCodecID(r io.Reader) (uint32, error) {
	var buffer [4]byte
	if _, err := io.ReadFull(r, buffer[:]); err != nil {
		return 0, fmt.Errorf("read codec id: %w", err)
	}
	return binary.BigEndian.Uint32(buffer[:]), nil
}

// ReadSessionHeader reads the session packet that follows the codec id. In v5
// the size lives here instead of in the codec header.
func ReadSessionHeader(r io.Reader) (PacketHeader, uint32, uint32, bool, error) {
	var buffer [12]byte
	if _, err := io.ReadFull(r, buffer[:]); err != nil {
		return PacketHeader{}, 0, 0, false, fmt.Errorf("read session header: %w", err)
	}
	header := PacketHeader{
		PTSAndFlags: binary.BigEndian.Uint64(buffer[0:8]),
		Size:        binary.BigEndian.Uint32(buffer[8:12]),
	}
	if !header.IsSession() {
		return PacketHeader{}, 0, 0, false, fmt.Errorf("expected session header, got flags %016x", header.PTSAndFlags)
	}
	width := binary.BigEndian.Uint32(buffer[4:8])
	height := binary.BigEndian.Uint32(buffer[8:12])
	clientResize := buffer[3]&1 != 0
	return header, width, height, clientResize, nil
}

// ReadVideoHeader reads the v5 stream preamble: codec id then session header.
func ReadVideoHeader(r io.Reader) (VideoHeader, error) {
	codec, err := ReadCodecID(r)
	if err != nil {
		return VideoHeader{}, err
	}
	_, width, height, _, err := ReadSessionHeader(r)
	if err != nil {
		return VideoHeader{}, err
	}
	return VideoHeader{
		Codec:  codec,
		Width:  width,
		Height: height,
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

// ReadVideoPacket reads the next stream element. A session header is returned
// in session with no payload; it may appear before the first frame and again
// whenever the stream is resized.
func ReadVideoPacket(r io.Reader) (header PacketHeader, data []byte, session *PacketHeader, err error) {
	header, err = ReadPacketHeader(r)
	if err != nil {
		return PacketHeader{}, nil, nil, err
	}
	if header.IsSession() {
		return header, nil, &header, nil
	}
	if header.Size > 64<<20 {
		return PacketHeader{}, nil, nil, fmt.Errorf("scrcpy packet too large: %d", header.Size)
	}
	data = make([]byte, header.Size)
	if _, err := io.ReadFull(r, data); err != nil {
		return PacketHeader{}, nil, nil, fmt.Errorf("read packet data: %w", err)
	}
	return header, data, nil, nil
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

// NormalizeTouchAction maps ACTION_CANCEL to ACTION_UP. scrcpy's
// PointersState only clears a pointer on UP, so forwarding CANCEL would leave a
// ghost pointer that eventually exhausts the pointer table.
func NormalizeTouchAction(action int) int {
	if action == TouchActionCancel {
		return TouchActionUp
	}
	return action
}

// WriteGetClipboard requests the device clipboard. copyKey 0 requests the
// current clipboard without injecting a copy/cut key.
func WriteGetClipboard(w io.Writer, copyKey byte) error {
	_, err := w.Write([]byte{CtrlGetClipboard, copyKey})
	return err
}

// WriteSetClipboard writes the clipboard and optionally asks the device to
// paste it. sequence 0 requests no acknowledgement.
func WriteSetClipboard(w io.Writer, sequence uint64, paste bool, text string) error {
	if len(text) > MaxClipboardBytes {
		return fmt.Errorf("clipboard text too large: %d", len(text))
	}
	data := []byte(text)
	buffer := make([]byte, 14+len(data))
	buffer[0] = CtrlSetClipboard
	binary.BigEndian.PutUint64(buffer[1:9], sequence)
	if paste {
		buffer[9] = 1
	}
	binary.BigEndian.PutUint32(buffer[10:14], uint32(len(data)))
	copy(buffer[14:], data)
	_, err := w.Write(buffer)
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
