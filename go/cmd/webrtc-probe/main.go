package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/mps233/la-pluma/go/internal/infra/adb"
	"github.com/mps233/la-pluma/go/internal/infra/scrcpy"
	scwebrtc "github.com/mps233/la-pluma/go/internal/infra/webrtc"
	"github.com/mps233/la-pluma/go/internal/transport/signaling"
)

const page = `<!doctype html>
<html><head><meta charset="utf-8"><title>La Pluma Pion probe</title>
<style>
body{background:#101318;color:#e8edf4;font:14px system-ui;margin:0;padding:16px}
#wrap{max-width:1100px;margin:0 auto} video{width:100%;background:#000;border-radius:12px}
button{margin:4px;padding:8px 12px;border-radius:8px;border:1px solid #334;background:#1b2029;color:#e8edf4}
#status{white-space:pre-wrap;color:#9fb0c6;margin:8px 0}
</style></head><body><div id="wrap">
<h2>La Pluma · Pion + scrcpy</h2>
<div id="status">connecting…</div>
<div id="videoState">video: waiting</div>
<video id="v" autoplay muted playsinline></video>
<div>
<button onclick="cmd('input keyevent 4')">Back</button>
<button onclick="cmd('input keyevent 3')">Home</button>
<button onclick="cmd('input keyevent 187')">Recents</button>
</div>
</div>
<script>
const v=document.getElementById('v'), statusEl=document.getElementById('status'), videoState=document.getElementById('videoState');
function videoInfo(){const q=v.getVideoPlaybackQuality? v.getVideoPlaybackQuality():null; return 'video '+v.videoWidth+'x'+v.videoHeight+' ready='+v.readyState+' paused='+v.paused+' frames='+(q?q.totalVideoFrames:'?');}
setInterval(()=>{videoState.textContent=videoInfo()+' touches='+touchCount},500);
v.onloadedmetadata=()=>{videoState.textContent=videoInfo(); v.play().catch(()=>{})};
v.onresize=()=>{videoState.textContent=videoInfo()};
let ws, pc, input, seq=0, width=0, height=0, touchCount=0;
function status(t){statusEl.textContent=t}
function send(obj){ if(ws&&ws.readyState===1) ws.send(JSON.stringify(obj)); }
function forward(payload){ send({message_type:'forward',payload}); }
function cmd(command){ send({message_type:'command',device_id:'mumu',request_id:Math.random().toString(36).slice(2),command}); }
function touch(action,x,y){
  if(!input||input.readyState!=='open'||!width||!height) {status('touch blocked input='+(input&&input.readyState)+' size='+width+'x'+height);return;}
  touchCount++; const ok=input.send(JSON.stringify({type:'touch',id:0,seq:++seq,client_ts_ms:Date.now(),action,x:Math.round(x),y:Math.round(y),w:width,h:height}));
  status('touch '+action+' sent '+(ok?input.bufferedAmount:'err'));
}
function xy(ev){ const r=v.getBoundingClientRect(); const s=Math.min(r.width/width,r.height/height); const w=width*s,h=height*s; const ox=(r.width-w)/2,oy=(r.height-h)/2; return {x:(ev.clientX-r.left-ox)/s,y:(ev.clientY-r.top-oy)/s}; }
let down=false;
v.addEventListener('pointerdown',e=>{down=true;v.setPointerCapture(e.pointerId);const p=xy(e);touch(0,p.x,p.y)});
v.addEventListener('pointermove',e=>{if(!down)return;const p=xy(e);touch(2,p.x,p.y)});
v.addEventListener('pointerup',e=>{if(!down)return;down=false;const p=xy(e);touch(1,p.x,p.y)});
v.addEventListener('pointercancel',e=>{if(!down)return;down=false;const p=xy(e);touch(3,p.x,p.y)});
async function main(){
  const login=await fetch('/api/login',{method:'POST'}); const {token}=await login.json();
  ws=new WebSocket('ws://'+location.host+'/connect_client?token='+encodeURIComponent(token)+'&deviceId=mumu');
  ws.onopen=()=>{status('signaling open');send({message_type:'connect',device_id:'mumu'});setInterval(()=>send({type:'ping'}),10000)};
  ws.onclose=()=>{status('signaling closed');};
  ws.onmessage=async ev=>{
    const msg=JSON.parse(ev.data); const type=msg.message_type||msg.type;
    status('msg '+type+(msg.payload&&msg.payload.type?':'+msg.payload.type:''));
    if(type==='pong')return;
    if(type==='config'){status('requesting offer');forward({type:'request-offer',ip_preference:'ipv4'});return;}
    if(type==='device_info'){const d=msg.device_info&&msg.device_info.displays&&msg.device_info.displays[0];if(d){width=d.x_res;height=d.y_res;status('device '+width+'x'+height);}return;}
    if(type==='device_msg'&&msg.payload){
      const p=msg.payload;
      if(p.type==='offer'){
        status('offer received ('+p.sdp.length+' bytes)');
        try {
        pc=new RTCPeerConnection({iceServers:[]});
        pc.ontrack=e=>{v.srcObject=e.streams[0];v.play().catch(()=>{});status('video track');};
        pc.ondatachannel=e=>{if(e.channel.label==='input-channel'){input=e.channel;status('input ready');}};
        pc.onicecandidate=e=>{if(e.candidate)forward({type:'ice-candidate',candidate:{candidate:e.candidate.candidate,sdpMid:e.candidate.sdpMid,sdpMLineIndex:e.candidate.sdpMLineIndex}})};
        await pc.setRemoteDescription({type:'offer',sdp:p.sdp});
        const answer=await pc.createAnswer(); await pc.setLocalDescription(answer);
        forward({type:'answer',sdp:pc.localDescription.sdp});
        status('answer sent');
        } catch(e) { status('offer error: '+e); }
      } else if(p.type==='ice-candidate'&&pc){ try{await pc.addIceCandidate(p.candidate)}catch(e){} }
      else if(p.type==='command_result'){status('command '+(p.success?'ok':'failed')+(p.output?': '+p.output:''));}
      else if(p.type==='scrcpy_error'){status('scrcpy error: '+p.message);}
    }
  };
}
main().catch(e=>status('error: '+e));
</script></body></html>`

func main() {
	var (
		adbPath = flag.String("adb", "/opt/homebrew/bin/adb", "adb executable")
		serial  = flag.String("serial", "127.0.0.1:16384", "device serial")
		server  = flag.String("server", "/tmp/scrcpy-server-v3.3.4", "scrcpy-server jar")
		version = flag.String("version", "3.3.4", "scrcpy server version")
		port    = flag.Int("port", 9191, "HTTP port")
		maxSize = flag.Int("max-size", 1280, "max video dimension")
		maxFPS  = flag.Int("max-fps", 30, "max fps")
		bitrate = flag.Int("bitrate", 4_000_000, "video bitrate")
	)
	flag.Parse()
	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	session := scrcpy.New(scrcpy.Options{
		ADB:           adb.New(*adbPath),
		Serial:        *serial,
		ServerPath:    *server,
		ServerVersion: *version,
		BitRate:       *bitrate,
		MaxSize:       *maxSize,
		MaxFPS:        *maxFPS,
		Control:       true,
		Audio:         false,
		Logger:        logger,
	})
	if err := session.Start(ctx); err != nil {
		logger.Error("start scrcpy", "error", err)
		os.Exit(1)
	}
	cancel()
	defer session.Close()

	publisher, err := scwebrtc.New(session, logger)
	if err != nil {
		logger.Error("publisher", "error", err)
		os.Exit(1)
	}
	defer publisher.Close()
	go publisher.FeedVideo()

	signalServer := signaling.New(func() *scwebrtc.Publisher { return publisher }, logger)
	signalServer.SetDeviceID(*serial)
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/login", signalServer.Login)
	mux.HandleFunc("GET /connect_client", signalServer.Connect)
	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write([]byte(page))
	})
	httpServer := &http.Server{Addr: fmt.Sprintf("127.0.0.1:%d", *port), Handler: mux, ReadHeaderTimeout: 10 * time.Second}
	go func() {
		logger.Info("webrtc probe", "url", "http://127.0.0.1:"+fmt.Sprint(*port))
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Error("http", "error", err)
		}
	}()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt, syscall.SIGTERM)
	<-sigCh
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer shutdownCancel()
	_ = httpServer.Shutdown(shutdownCtx)
}
