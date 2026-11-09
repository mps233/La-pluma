//go:build darwin

package main

import (
	"github.com/ebitengine/purego/objc"

	"github.com/egoist/mygo"
)

// roundWindowCorners cuts the window's content view to corners of radius, in
// DIPs. MyGo only applies WindowOptions.CornerRadius to a frameless window,
// which also hides the native traffic lights; the main window keeps them, so
// this applies the same content-layer treatment itself.
func roundWindowCorners(window *mygo.Window, radius float64) {
	handle := window.NativeHandle()
	if handle == 0 {
		return
	}
	win := objc.ID(handle)
	view := objc.Send[objc.ID](win, objc.RegisterName("contentView"))
	if view == 0 {
		return
	}
	objc.Send[objc.ID](view, objc.RegisterName("setWantsLayer:"), uintptr(1))
	layer := objc.Send[objc.ID](view, objc.RegisterName("layer"))
	if layer == 0 {
		return
	}
	// The sidebar glass uses a CSS border-radius, a circular corner; the
	// default corner curve matches it.
	objc.Send[objc.ID](layer, objc.RegisterName("setCornerRadius:"), radius)
	objc.Send[objc.ID](layer, objc.RegisterName("setMasksToBounds:"), uintptr(1))
	if objc.Send[bool](win, objc.RegisterName("isOpaque")) {
		// Move the window color into the content layer and clear the window,
		// so the area outside the corners is transparent and the shadow is
		// drawn from the rounded content.
		if background := objc.Send[objc.ID](win, objc.RegisterName("backgroundColor")); background != 0 {
			objc.Send[objc.ID](layer, objc.RegisterName("setBackgroundColor:"),
				objc.Send[objc.ID](background, objc.RegisterName("CGColor")))
		}
		objc.Send[objc.ID](win, objc.RegisterName("setOpaque:"), uintptr(0))
		clear := objc.Send[objc.ID](objc.ID(objc.GetClass("NSColor")), objc.RegisterName("clearColor"))
		objc.Send[objc.ID](win, objc.RegisterName("setBackgroundColor:"), clear)
	}
	objc.Send[objc.ID](win, objc.RegisterName("invalidateShadow"))
}
