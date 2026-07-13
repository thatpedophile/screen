import React, { useState, useEffect, useRef } from 'react';
import { 
  Monitor, 
  Camera, 
  Tv, 
  Users, 
  Key, 
  Copy, 
  Check, 
  RotateCw, 
  Power, 
  Mic, 
  MicOff, 
  Lock, 
  ShieldAlert, 
  Activity, 
  Info, 
  X, 
  ArrowLeft, 
  AlertCircle, 
  ExternalLink, 
  Volume2, 
  VolumeX, 
  Maximize, 
  Cast
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { AppRole, MediaSourceType, StreamerStatus, WatcherStatus } from './types';

// Helper to generate funny/readable Room IDs
function generateRoomId(): string {
  const adjectives = ['cosmic', 'swift', 'amber', 'silent', 'crystal', 'quantum', 'spectral', 'stellar', 'sonic', 'aurora'];
  const nouns = ['orbit', 'vortex', 'beam', 'shield', 'wave', 'stream', 'pulse', 'beacon', 'gate', 'crest'];
  const randAdj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const randNoun = nouns[Math.floor(Math.random() * nouns.length)];
  const num = Math.floor(10 + Math.random() * 90);
  return `${randAdj}-${randNoun}-${num}`;
}

export default function App() {
  const [role, setRole] = useState<AppRole>('home');
  
  // Room credentials state
  const [streamId, setStreamId] = useState('');
  const [password, setPassword] = useState('');
  
  // Custom streamer settings
  const [sourceType, setSourceType] = useState<MediaSourceType>(() => {
    return (typeof window !== 'undefined' && window.self !== window.top) ? 'camera' : 'screen';
  });
  const [audioEnabled, setAudioEnabled] = useState(true);
  
  // UI States
  const [copied, setCopied] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  
  // Streamer status state
  const [streamerStatus, setStreamerStatus] = useState<StreamerStatus>({
    isActive: false,
    watcherCount: 0,
    selectedSource: 'screen',
    audioEnabled: true,
    connectionState: 'idle'
  });

  // Watcher status state
  const [watcherStatus, setWatcherStatus] = useState<WatcherStatus>({
    connectionState: 'idle'
  });

  // Streamer WebRTC refs
  const wsRef = useRef<WebSocket | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);

  // Watcher WebRTC refs
  const watcherWsRef = useRef<WebSocket | null>(null);
  const watcherPcRef = useRef<RTCPeerConnection | null>(null);
  const watcherVideoRef = useRef<HTMLVideoElement | null>(null);
  const myWatcherIdRef = useRef<string | null>(null);

  // Auto populate stream ID and optional password on role selection
  useEffect(() => {
    if (role === 'streamer') {
      setStreamId(generateRoomId());
      setPassword(Math.random().toString(36).substring(2, 8).toUpperCase());
    } else if (role === 'watcher') {
      // Check if URL has stream ID query param
      const params = new URLSearchParams(window.location.search);
      const urlStreamId = params.get('room');
      if (urlStreamId) {
        setStreamId(urlStreamId);
      } else {
        setStreamId('');
      }
      setPassword('');
    }
  }, [role]);

  // Clean up all media/network connections on component unmount
  useEffect(() => {
    return () => {
      cleanupStreamer();
      cleanupWatcher();
    };
  }, []);

  // Set up copy to clipboard feedback
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // --- STREAMER CORE HANDLERS ---
  const handleWatcherJoined = async (watcherId: string) => {
    const ws = wsRef.current;
    const localStream = localStreamRef.current;
    if (!ws || !localStream) return;

    console.log(`Setting up new PeerConnection for Watcher "${watcherId}"`);

    // Clean up any existing connection with this specific watcher (idempotency)
    if (peersRef.current.has(watcherId)) {
      peersRef.current.get(watcherId)?.close();
    }

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    });

    peersRef.current.set(watcherId, pc);
    setStreamerStatus(prev => ({ ...prev, watcherCount: peersRef.current.size }));

    // Add local media tracks to connection
    localStream.getTracks().forEach(track => {
      pc.addTrack(track, localStream);
    });

    // Handle candidates
    pc.onicecandidate = (event) => {
      if (event.candidate && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'signal',
          targetId: watcherId,
          signalData: { candidate: event.candidate }
        }));
      }
    };

    pc.onconnectionstatechange = () => {
      console.log(`PeerConnection state for ${watcherId}: ${pc.connectionState}`);
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        pc.close();
        peersRef.current.delete(watcherId);
        setStreamerStatus(prev => ({ ...prev, watcherCount: peersRef.current.size }));
      }
    };

    // Create session offer
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      ws.send(JSON.stringify({
        type: 'signal',
        targetId: watcherId,
        signalData: { sdp: pc.localDescription }
      }));
    } catch (err) {
      console.error('Error creating local offer for watcher:', err);
    }
  };

  const startStreaming = async () => {
    if (!streamId.trim()) {
      alert("Please specify a Stream ID");
      return;
    }

    setStreamerStatus(prev => ({ ...prev, connectionState: 'connecting', errorMessage: undefined }));

    try {
      let stream: MediaStream;

      if (sourceType === 'screen') {
        if (typeof window !== 'undefined' && window.self !== window.top) {
          throw new Error("Screen sharing is restricted inside the preview iframe. Please click the 'Open in New Tab' button in the top right of AI Studio to start sharing your screen, or choose 'Camera' mode!");
        }
        if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
          throw new Error("Screen sharing is not supported on this browser or mobile device. Please choose 'Camera Stream' instead!");
        }
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            displaySurface: 'monitor'
          },
          audio: audioEnabled
        });
      } else {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error("Camera streaming is not supported on this browser/device.");
        }
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'user',
            width: { ideal: 1280 },
            height: { ideal: 720 }
          },
          audio: audioEnabled
        });
      }

      localStreamRef.current = stream;
      if (previewVideoRef.current) {
        previewVideoRef.current.srcObject = stream;
      }

      // Automatically handle stream termination (e.g., user clicked "Stop Sharing" chrome footer)
      stream.getVideoTracks()[0].onended = () => {
        stopStreaming();
      };

      // Establish signaling socket
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${wsProtocol}//${window.location.host}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(JSON.stringify({
          type: 'create_room',
          streamId: streamId.trim(),
          password: password.trim()
        }));
      };

      ws.onmessage = async (event) => {
        try {
          const data = JSON.parse(event.data);

          switch (data.type) {
            case 'room_created':
              setStreamerStatus(prev => ({
                ...prev,
                isActive: true,
                connectionState: 'streaming'
              }));
              break;

            case 'watcher_joined':
              await handleWatcherJoined(data.watcherId);
              break;

            case 'watcher_left': {
              const pc = peersRef.current.get(data.watcherId);
              if (pc) {
                pc.close();
                peersRef.current.delete(data.watcherId);
              }
              setStreamerStatus(prev => ({ ...prev, watcherCount: peersRef.current.size }));
              break;
            }

            case 'signal': {
              const pc = peersRef.current.get(data.senderId);
              if (pc) {
                if (data.signalData.sdp) {
                  await pc.setRemoteDescription(new RTCSessionDescription(data.signalData.sdp));
                } else if (data.signalData.candidate) {
                  await pc.addIceCandidate(new RTCIceCandidate(data.signalData.candidate));
                }
              }
              break;
            }

            case 'error':
              throw new Error(data.message || "Signaling error occurred.");
          }
        } catch (err: any) {
          console.error("Streamer signal error:", err);
          setStreamerStatus(prev => ({
            ...prev,
            connectionState: 'error',
            errorMessage: err.message || "Signaling error."
          }));
          stopStreaming();
        }
      };

      ws.onerror = () => {
        setStreamerStatus(prev => ({
          ...prev,
          connectionState: 'error',
          errorMessage: 'Signaling server connection lost.'
        }));
        stopStreaming();
      };

      ws.onclose = () => {
        setStreamerStatus(prev => ({
          ...prev,
          isActive: false,
          connectionState: 'idle'
        }));
      };

    } catch (err: any) {
      console.error(err);
      let errMsg = err.message || "Failed to capture media stream.";
      if (
        err.name === 'NotAllowedError' || 
        errMsg.toLowerCase().includes('permissions policy') || 
        errMsg.toLowerCase().includes('disallowed') || 
        errMsg.toLowerCase().includes('permission')
      ) {
        if (sourceType === 'screen') {
          errMsg = "Screen sharing is restricted inside the preview iframe. Please click the 'Open in New Tab' button in the top right of AI Studio to start sharing your screen, or choose 'Camera' mode!";
        } else {
          errMsg = "Camera access is restricted or denied. Please grant camera permissions, or click the 'Open in New Tab' button in the top right of AI Studio to bypass iframe constraints.";
        }
      }
      setStreamerStatus(prev => ({
        ...prev,
        connectionState: 'error',
        errorMessage: errMsg
      }));
      cleanupStreamer();
    }
  };

  const stopStreaming = () => {
    cleanupStreamer();
    setStreamerStatus({
      isActive: false,
      watcherCount: 0,
      selectedSource: sourceType,
      audioEnabled: audioEnabled,
      connectionState: 'idle'
    });
  };

  const cleanupStreamer = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
    if (previewVideoRef.current) {
      previewVideoRef.current.srcObject = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    peersRef.current.forEach(pc => pc.close());
    peersRef.current.clear();
  };


  // --- WATCHER CORE HANDLERS ---
  const handleIncomingOffer = async (sdp: RTCSessionDescriptionInit) => {
    const ws = watcherWsRef.current;
    if (!ws) return;

    console.log("Processing incoming stream offer...");

    if (watcherPcRef.current) {
      watcherPcRef.current.close();
    }

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    });

    watcherPcRef.current = pc;

    pc.ontrack = (event) => {
      console.log("Received media track from streamer!", event.streams);
      if (watcherVideoRef.current) {
        watcherVideoRef.current.srcObject = event.streams[0];
      }
      setWatcherStatus({ connectionState: 'connected' });
    };

    pc.onicecandidate = (event) => {
      if (event.candidate && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'signal',
          signalData: { candidate: event.candidate }
        }));
      }
    };

    pc.onconnectionstatechange = () => {
      console.log(`Watcher PeerConnection state: ${pc.connectionState}`);
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        setWatcherStatus({ connectionState: 'streamer-offline' });
      }
    };

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      ws.send(JSON.stringify({
        type: 'signal',
        signalData: { sdp: pc.localDescription }
      }));
    } catch (err) {
      console.error("Error negotiating WebRTC connection with streamer:", err);
    }
  };

  const startWatching = async () => {
    if (!streamId.trim()) {
      setWatcherStatus({ connectionState: 'error', errorMessage: 'Stream ID is required.' });
      return;
    }

    setWatcherStatus({ connectionState: 'connecting' });

    try {
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${wsProtocol}//${window.location.host}`;
      const ws = new WebSocket(wsUrl);
      watcherWsRef.current = ws;

      ws.onopen = () => {
        ws.send(JSON.stringify({
          type: 'join_room',
          streamId: streamId.trim(),
          password: password.trim()
        }));
      };

      ws.onmessage = async (event) => {
        try {
          const data = JSON.parse(event.data);

          switch (data.type) {
            case 'room_joined':
              myWatcherIdRef.current = data.watcherId;
              if (data.streamerActive) {
                setWatcherStatus({ connectionState: 'connecting' });
              } else {
                setWatcherStatus({ connectionState: 'streamer-offline' });
              }
              break;

            case 'signal':
              if (data.signalData.sdp) {
                await handleIncomingOffer(data.signalData.sdp);
              } else if (data.signalData.candidate) {
                if (watcherPcRef.current) {
                  await watcherPcRef.current.addIceCandidate(new RTCIceCandidate(data.signalData.candidate));
                }
              }
              break;

            case 'streamer_left':
              if (watcherPcRef.current) {
                watcherPcRef.current.close();
                watcherPcRef.current = null;
              }
              if (watcherVideoRef.current) {
                watcherVideoRef.current.srcObject = null;
              }
              setWatcherStatus({ connectionState: 'streamer-offline' });
              break;

            case 'error':
              setWatcherStatus({ connectionState: 'error', errorMessage: data.message || "Failed to join." });
              ws.close();
              break;
          }
        } catch (err: any) {
          console.error("Watcher payload parse error:", err);
        }
      };

      ws.onerror = () => {
        setWatcherStatus({ connectionState: 'error', errorMessage: "Could not link to signaling server." });
      };

      ws.onclose = () => {
        setWatcherStatus(prev => {
          if (prev.connectionState === 'error') return prev;
          return { connectionState: 'disconnected' };
        });
      };

    } catch (err: any) {
      console.error(err);
      setWatcherStatus({ connectionState: 'error', errorMessage: err.message || "An unexpected error occurred." });
    }
  };

  const stopWatching = () => {
    cleanupWatcher();
    setWatcherStatus({ connectionState: 'idle' });
  };

  const cleanupWatcher = () => {
    if (watcherWsRef.current) {
      watcherWsRef.current.close();
      watcherWsRef.current = null;
    }
    if (watcherPcRef.current) {
      watcherPcRef.current.close();
      watcherPcRef.current = null;
    }
    if (watcherVideoRef.current) {
      watcherVideoRef.current.srcObject = null;
    }
    myWatcherIdRef.current = null;
  };

  // Toggle video volume (mute/unmute)
  const toggleMute = () => {
    if (watcherVideoRef.current) {
      watcherVideoRef.current.muted = !watcherVideoRef.current.muted;
      setIsMuted(watcherVideoRef.current.muted);
    }
  };

  // Toggle fullscreen mode
  const toggleFullscreen = () => {
    const videoElement = watcherVideoRef.current;
    if (videoElement) {
      if (!document.fullscreenElement) {
        videoElement.requestFullscreen().catch(err => {
          console.error(`Error attempting to enable full-screen: ${err.message}`);
        });
        setIsFullscreen(true);
      } else {
        document.exitFullscreen();
        setIsFullscreen(false);
      }
    }
  };

  // Build the Share URL
  const getShareUrl = () => {
    const base = window.location.origin + window.location.pathname;
    return `${base}?room=${encodeURIComponent(streamId)}`;
  };

  return (
    <div className="min-h-screen flex flex-col font-sans relative overflow-hidden bg-radial from-[#131b2e] via-[#0b0f19] to-[#05070d]">
      
      {/* Decorative Grid Background */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#1f293710_1px,transparent_1px),linear-gradient(to_bottom,#1f293710_1px,transparent_1px)] bg-[size:4rem_4rem] pointer-events-none" />
      
      {/* Glow Rings */}
      <div className="absolute -top-40 -left-40 w-96 h-96 rounded-full bg-indigo-500/10 blur-3xl pointer-events-none" />
      <div className="absolute -bottom-40 -right-40 w-96 h-96 rounded-full bg-emerald-500/5 blur-3xl pointer-events-none" />

      {/* Header Bar */}
      <header className="border-b border-gray-800/60 bg-[#0b0f19]/80 backdrop-blur-md px-6 py-4 flex items-center justify-between relative z-10">
        <div className="flex items-center gap-3 cursor-pointer" onClick={() => { if (role !== 'home') { stopStreaming(); stopWatching(); setRole('home'); } }}>
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-500 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-indigo-500/20">
            <Cast className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <h1 className="text-lg font-bold font-sans tracking-tight text-white flex items-center gap-2">
              Screen Share Room
            </h1>
            <p className="text-xs text-gray-400 font-mono">v1.2.0 • Peer-to-Peer Signaling</p>
          </div>
        </div>

        {role !== 'home' && (
          <button 
            onClick={() => {
              stopStreaming();
              stopWatching();
              setRole('home');
            }}
            className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition bg-gray-800/40 hover:bg-gray-800 px-3.5 py-1.5 rounded-lg border border-gray-700/50"
            id="back-home-button"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Leave Space</span>
          </button>
        )}
      </header>

      {/* Main Container */}
      <main className="flex-1 flex flex-col justify-center max-w-5xl w-full mx-auto p-4 sm:p-6 relative z-10">
        
        <AnimatePresence mode="wait">
          {role === 'home' && (
            <motion.div 
              key="home"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              className="grid md:grid-cols-2 gap-6 max-w-4xl mx-auto w-full px-2"
            >
              {/* Option Cards */}
              <div className="col-span-2 text-center mb-4">
                <h2 className="text-3xl font-extrabold text-white tracking-tight font-sans bg-clip-text text-transparent bg-gradient-to-r from-white via-gray-200 to-gray-400">
                  Instant Peer-to-Peer Broadcasting
                </h2>
                <p className="text-gray-400 mt-2 max-w-md mx-auto text-sm">
                  Share your active screen or high-definition camera with any device instantly. Zero software downloads required.
                </p>
              </div>

              {/* Streamer Card */}
              <motion.div 
                whileHover={{ y: -4, scale: 1.01 }}
                whileTap={{ scale: 0.99 }}
                className="bg-gradient-to-b from-[#182035] to-[#111728] border border-indigo-500/20 hover:border-indigo-500/40 rounded-2xl p-6 sm:p-8 shadow-2xl flex flex-col justify-between group cursor-pointer relative overflow-hidden"
                onClick={() => setRole('streamer')}
                id="role-streamer-card"
              >
                <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/5 rounded-full blur-2xl group-hover:bg-indigo-500/10 transition duration-500" />
                
                <div>
                  <div className="w-12 h-12 rounded-xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center mb-6 group-hover:bg-indigo-500 group-hover:text-white transition duration-300">
                    <Monitor className="w-6 h-6" />
                  </div>
                  <h3 className="text-xl font-bold text-white group-hover:text-indigo-300 transition font-sans">
                    I want to Stream
                  </h3>
                  <p className="text-gray-400 text-sm mt-2 leading-relaxed">
                    Broadcast your current desktop, Chrome tab, full window, or camera device securely to your viewers.
                  </p>
                </div>
                
                <div className="mt-8 flex items-center text-sm font-semibold text-indigo-400 group-hover:text-indigo-300 gap-1.5 font-mono">
                  Create Room & Start &rarr;
                </div>
              </motion.div>

              {/* Watcher Card */}
              <motion.div 
                whileHover={{ y: -4, scale: 1.01 }}
                whileTap={{ scale: 0.99 }}
                className="bg-gradient-to-b from-[#122325] to-[#0c181b] border border-emerald-500/20 hover:border-emerald-500/40 rounded-2xl p-6 sm:p-8 shadow-2xl flex flex-col justify-between group cursor-pointer relative overflow-hidden"
                onClick={() => setRole('watcher')}
                id="role-watcher-card"
              >
                <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/5 rounded-full blur-2xl group-hover:bg-emerald-500/10 transition duration-500" />
                
                <div>
                  <div className="w-12 h-12 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center mb-6 group-hover:bg-emerald-500 group-hover:text-white transition duration-300">
                    <Tv className="w-6 h-6" />
                  </div>
                  <h3 className="text-xl font-bold text-white group-hover:text-emerald-300 transition font-sans">
                    I want to Watch
                  </h3>
                  <p className="text-gray-400 text-sm mt-2 leading-relaxed">
                    View a friend's active broadcast simply by typing their secure Stream Room ID and verification passcode.
                  </p>
                </div>
                
                <div className="mt-8 flex items-center text-sm font-semibold text-emerald-400 group-hover:text-emerald-300 gap-1.5 font-mono">
                  Join Room & Watch &rarr;
                </div>
              </motion.div>

              <div className="col-span-2 text-center mt-6 border-t border-gray-800/50 pt-6">
                <p className="text-xs text-gray-500 flex items-center justify-center gap-1.5">
                  <Activity className="w-3.5 h-3.5 text-indigo-400" />
                  Secure connections established via high-performance Google STUN architecture
                </p>
              </div>
            </motion.div>
          )}

          {role === 'streamer' && (
            <motion.div 
              key="streamer"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              className="w-full max-w-4xl mx-auto grid md:grid-cols-12 gap-6"
            >
              {/* Left Column: Config Panel */}
              <div className="md:col-span-4 flex flex-col gap-5">
                <div className="bg-gray-900/50 border border-gray-800 rounded-2xl p-5 shadow-xl">
                  <h3 className="text-md font-bold text-white mb-4 flex items-center gap-2 border-b border-gray-800 pb-3">
                    <Lock className="w-4 h-4 text-indigo-400" />
                    <span>Space Credentials</span>
                  </h3>

                  <div className="space-y-4">
                    {/* Stream ID */}
                    <div>
                      <label className="block text-xs font-mono font-bold uppercase tracking-wider text-gray-400 mb-1.5">
                        Stream ID
                      </label>
                      <div className="relative">
                        <input 
                          type="text" 
                          value={streamId}
                          onChange={(e) => !streamerStatus.isActive && setStreamId(e.target.value)}
                          disabled={streamerStatus.isActive}
                          className="w-full bg-[#131926] text-white border border-gray-700/60 disabled:border-gray-800 disabled:opacity-60 rounded-lg py-2 pl-3 pr-10 text-sm font-mono focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                          placeholder="e.g. swift-pulse-41"
                          id="streamer-id-input"
                        />
                        {!streamerStatus.isActive && (
                          <button 
                            onClick={() => setStreamId(generateRoomId())}
                            className="absolute right-2.5 top-2.5 text-gray-400 hover:text-white transition"
                            title="Generate another Room ID"
                          >
                            <RotateCw className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Password */}
                    <div>
                      <label className="block text-xs font-mono font-bold uppercase tracking-wider text-gray-400 mb-1.5">
                        Password
                      </label>
                      <input 
                        type="text" 
                        value={password}
                        onChange={(e) => !streamerStatus.isActive && setPassword(e.target.value)}
                        disabled={streamerStatus.isActive}
                        className="w-full bg-[#131926] text-white border border-gray-700/60 disabled:border-gray-800 disabled:opacity-60 rounded-lg py-2 px-3 text-sm font-mono focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                        placeholder="e.g. PASS42"
                        id="streamer-password-input"
                      />
                    </div>
                  </div>
                </div>

                {/* Media Settings Panel */}
                <div className="bg-gray-900/50 border border-gray-800 rounded-2xl p-5 shadow-xl">
                  <h3 className="text-md font-bold text-white mb-4 flex items-center gap-2 border-b border-gray-800 pb-3">
                    <Monitor className="w-4 h-4 text-indigo-400" />
                    <span>Media Settings</span>
                  </h3>

                  <div className="space-y-4">
                    {/* Media Source Choices */}
                    <div>
                      <label className="block text-xs font-mono font-bold uppercase tracking-wider text-gray-400 mb-2">
                        Source Selection
                      </label>
                      <div className="grid grid-cols-2 gap-2 bg-[#131926] p-1 rounded-lg">
                        <button
                          onClick={() => !streamerStatus.isActive && setSourceType('screen')}
                          disabled={streamerStatus.isActive}
                          className={`flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition ${
                            sourceType === 'screen'
                              ? 'bg-indigo-500 text-white shadow'
                              : 'text-gray-400 hover:text-white'
                          }`}
                          id="source-screen-button"
                        >
                          <Monitor className="w-3.5 h-3.5" />
                          <span>Screen</span>
                        </button>
                        <button
                          onClick={() => !streamerStatus.isActive && setSourceType('camera')}
                          disabled={streamerStatus.isActive}
                          className={`flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition ${
                            sourceType === 'camera'
                              ? 'bg-indigo-500 text-white shadow'
                              : 'text-gray-400 hover:text-white'
                          }`}
                          id="source-camera-button"
                        >
                          <Camera className="w-3.5 h-3.5" />
                          <span>Camera</span>
                        </button>
                      </div>
                    </div>

                    {/* IFrame Screen Share Warning Banner */}
                    {typeof window !== 'undefined' && window.self !== window.top && sourceType === 'screen' && (
                      <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 flex gap-2 text-xs text-amber-300">
                        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                        <div>
                          Screen sharing is restricted inside the preview iframe. Please click <strong>Open in New Tab</strong> in the top-right of AI Studio to share your screen, or choose <strong>Camera</strong> mode.
                        </div>
                      </div>
                    )}

                    {/* Microphone Audio Switch */}
                    <div className="flex items-center justify-between pt-1">
                      <div className="flex flex-col">
                        <span className="text-xs font-medium text-white">Capture Audio</span>
                        <span className="text-[10px] text-gray-400 font-mono">Include system/microphone</span>
                      </div>
                      <button
                        onClick={() => !streamerStatus.isActive && setAudioEnabled(!audioEnabled)}
                        disabled={streamerStatus.isActive}
                        className={`w-10 h-6 flex items-center rounded-full p-1 cursor-pointer transition-colors duration-300 focus:outline-none ${
                          audioEnabled ? 'bg-indigo-500' : 'bg-gray-800'
                        } disabled:opacity-40`}
                        id="audio-enabled-switch"
                      >
                        <div
                          className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform duration-300 ${
                            audioEnabled ? 'translate-x-4' : 'translate-x-0'
                          }`}
                        />
                      </button>
                    </div>

                    {/* Broadcast Action Button */}
                    <div className="pt-3">
                      {!streamerStatus.isActive ? (
                        <button
                          onClick={startStreaming}
                          disabled={streamerStatus.connectionState === 'connecting'}
                          className="w-full bg-indigo-500 hover:bg-indigo-600 disabled:bg-indigo-800 disabled:cursor-not-allowed text-white font-medium py-2.5 px-4 rounded-xl shadow-lg shadow-indigo-500/20 transition flex items-center justify-center gap-2"
                          id="start-stream-button"
                        >
                          {streamerStatus.connectionState === 'connecting' ? (
                            <>
                              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                              <span>Starting Stream...</span>
                            </>
                          ) : (
                            <>
                              <Power className="w-4 h-4" />
                              <span>Start Broadcast</span>
                            </>
                          )}
                        </button>
                      ) : (
                        <button
                          onClick={stopStreaming}
                          className="w-full bg-rose-500 hover:bg-rose-600 text-white font-medium py-2.5 px-4 rounded-xl shadow-lg shadow-rose-500/20 transition flex items-center justify-center gap-2"
                          id="stop-stream-button"
                        >
                          <Power className="w-4 h-4" />
                          <span>Stop Broadcast</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Compatibility Note */}
                <div className="text-[11px] text-gray-400/80 bg-gray-900/20 border border-gray-800/40 rounded-xl p-3 flex items-start gap-2">
                  <Info className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
                  <p className="leading-normal font-mono">
                    Screen-sharing works beautifully on PCs/Laptops. If on Chrome/iOS on mobile, choose <b className="text-indigo-300">Camera</b> mode instead.
                  </p>
                </div>
              </div>

              {/* Right Column: Video Preview and Live Stats */}
              <div className="md:col-span-8 flex flex-col gap-5">
                
                {/* Live Status Header */}
                <div className="bg-gray-900/50 border border-gray-800 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4 shadow-xl">
                  <div className="flex items-center gap-3">
                    <div className={`w-3 h-3 rounded-full ${streamerStatus.isActive ? 'bg-indigo-500 animate-pulse' : 'bg-gray-600'}`} />
                    <div>
                      <div className="text-sm font-semibold text-white flex items-center gap-2">
                        Status: {streamerStatus.isActive ? 'Broadcasting Live' : 'Offline'}
                        {streamerStatus.isActive && (
                          <span className="bg-indigo-500/10 text-indigo-400 text-[10px] font-mono py-0.5 px-2 rounded-full border border-indigo-500/20">
                            P2P
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5 font-mono">
                        {streamerStatus.isActive 
                          ? `Source: ${streamerStatus.selectedSource === 'screen' ? 'Screen Share' : 'Camera Device'}`
                          : 'Awaiting your broadcast connection'}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 text-xs font-mono">
                    <div className="flex items-center gap-1.5 bg-gray-800/40 border border-gray-700/30 px-3 py-1.5 rounded-lg text-gray-300">
                      <Users className="w-3.5 h-3.5 text-indigo-400" />
                      <span>Watchers: <b className="text-white font-sans">{streamerStatus.watcherCount}</b></span>
                    </div>
                  </div>
                </div>

                {/* Video Monitor */}
                <div className="bg-[#0e121e] border border-gray-800 rounded-2xl aspect-video relative flex items-center justify-center overflow-hidden shadow-2xl">
                  
                  {/* Real Video Element */}
                  <video 
                    ref={previewVideoRef}
                    autoPlay 
                    playsInline 
                    muted 
                    className={`w-full h-full object-contain bg-[#07090f] transition-opacity duration-300 ${
                      streamerStatus.isActive ? 'opacity-100' : 'opacity-0'
                    }`}
                  />

                  {/* Empty State Overlay */}
                  {!streamerStatus.isActive && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center z-10 bg-[#0e121e]">
                      <div className="w-14 h-14 rounded-full bg-gray-800/40 flex items-center justify-center mb-4 text-gray-500">
                        <Monitor className="w-7 h-7" />
                      </div>
                      <h4 className="text-white font-bold text-sm">Media Monitor Sandbox</h4>
                      <p className="text-xs text-gray-400 mt-2 max-w-sm leading-relaxed">
                        Your broadcast preview will materialize here once you click the <b className="text-indigo-400">Start Broadcast</b> button.
                      </p>
                    </div>
                  )}

                  {/* Red Live Label */}
                  {streamerStatus.isActive && (
                    <div className="absolute top-4 left-4 bg-rose-500 text-white text-[10px] uppercase font-bold tracking-widest py-1 px-2.5 rounded-md flex items-center gap-1.5 shadow-md">
                      <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping" />
                      LIVE MONITOR
                    </div>
                  )}
                </div>

                {/* Invite Controls */}
                {streamerStatus.isActive && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-gray-950/60 border border-indigo-500/10 rounded-2xl p-5 shadow-xl flex flex-col gap-3"
                  >
                    <div>
                      <h4 className="text-sm font-semibold text-white">Invite Watchers</h4>
                      <p className="text-xs text-gray-400 mt-1">Copy this link or room details to allow viewers to link in instantly.</p>
                    </div>

                    <div className="flex gap-2">
                      <input 
                        type="text" 
                        readOnly
                        value={getShareUrl()}
                        className="flex-1 bg-[#121625] text-xs font-mono text-gray-300 border border-gray-800/80 rounded-lg px-3 py-2.5 focus:outline-none"
                      />
                      <button
                        onClick={() => copyToClipboard(getShareUrl())}
                        className="bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 border border-indigo-500/20 hover:border-indigo-500/40 px-4 rounded-lg flex items-center justify-center gap-1.5 transition text-xs font-medium"
                        id="copy-stream-link-button"
                      >
                        {copied ? (
                          <>
                            <Check className="w-4 h-4 text-emerald-400" />
                            <span className="text-emerald-400">Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-4 h-4" />
                            <span>Copy Link</span>
                          </>
                        )}
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-3 mt-1.5 pt-3 border-t border-gray-900/80">
                      <div className="bg-[#121625]/40 p-2.5 rounded-lg border border-gray-800/50">
                        <span className="text-[10px] font-mono text-gray-400 block uppercase">Room ID</span>
                        <span className="text-xs font-mono font-bold text-white block mt-0.5">{streamId}</span>
                      </div>
                      <div className="bg-[#121625]/40 p-2.5 rounded-lg border border-gray-800/50">
                        <span className="text-[10px] font-mono text-gray-400 block uppercase">Passcode</span>
                        <span className="text-xs font-mono font-bold text-white block mt-0.5">{password}</span>
                      </div>
                    </div>
                  </motion.div>
                )}

                {streamerStatus.errorMessage && (
                  <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-xl p-4 flex items-start gap-3">
                    <ShieldAlert className="w-5 h-5 shrink-0" />
                    <div>
                      <h4 className="text-sm font-semibold">Broadcasting Error</h4>
                      <p className="text-xs mt-1 leading-relaxed">{streamerStatus.errorMessage}</p>
                    </div>
                  </div>
                )}

              </div>
            </motion.div>
          )}

          {role === 'watcher' && (
            <motion.div 
              key="watcher"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              className="w-full max-w-4xl mx-auto grid md:grid-cols-12 gap-6"
            >
              
              {/* Left Configuration Panel */}
              <div className="md:col-span-4 flex flex-col gap-5">
                <div className="bg-gray-900/50 border border-gray-800 rounded-2xl p-5 shadow-xl">
                  <h3 className="text-md font-bold text-white mb-4 flex items-center gap-2 border-b border-gray-800 pb-3">
                    <Key className="w-4 h-4 text-emerald-400" />
                    <span>Watch Credentials</span>
                  </h3>

                  <div className="space-y-4">
                    {/* Stream ID */}
                    <div>
                      <label className="block text-xs font-mono font-bold uppercase tracking-wider text-gray-400 mb-1.5">
                        Stream ID
                      </label>
                      <input 
                        type="text" 
                        value={streamId}
                        onChange={(e) => watcherStatus.connectionState !== 'connected' && setStreamId(e.target.value)}
                        disabled={watcherStatus.connectionState === 'connected' || watcherStatus.connectionState === 'connecting'}
                        className="w-full bg-[#131926] text-white border border-gray-700/60 disabled:border-gray-800 disabled:opacity-60 rounded-lg py-2 px-3 text-sm font-mono focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                        placeholder="e.g. quantum-beacon-42"
                        id="watcher-id-input"
                      />
                    </div>

                    {/* Password */}
                    <div>
                      <label className="block text-xs font-mono font-bold uppercase tracking-wider text-gray-400 mb-1.5">
                        Verification Passcode
                      </label>
                      <input 
                        type="password" 
                        value={password}
                        onChange={(e) => watcherStatus.connectionState !== 'connected' && setPassword(e.target.value)}
                        disabled={watcherStatus.connectionState === 'connected' || watcherStatus.connectionState === 'connecting'}
                        className="w-full bg-[#131926] text-white border border-gray-700/60 disabled:border-gray-800 disabled:opacity-60 rounded-lg py-2 px-3 text-sm font-mono focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                        placeholder="••••••••"
                        id="watcher-password-input"
                      />
                    </div>

                    {/* Action Toggle Button */}
                    <div className="pt-2">
                      {watcherStatus.connectionState !== 'connected' && watcherStatus.connectionState !== 'connecting' ? (
                        <button
                          onClick={startWatching}
                          className="w-full bg-emerald-500 hover:bg-emerald-600 text-white font-medium py-2.5 px-4 rounded-xl shadow-lg shadow-emerald-500/20 transition flex items-center justify-center gap-2"
                          id="watcher-connect-button"
                        >
                          <Tv className="w-4 h-4" />
                          <span>Link Stream</span>
                        </button>
                      ) : (
                        <button
                          onClick={stopWatching}
                          className="w-full bg-rose-500 hover:bg-rose-600 text-white font-medium py-2.5 px-4 rounded-xl shadow-lg shadow-rose-500/20 transition flex items-center justify-center gap-2"
                          id="watcher-disconnect-button"
                        >
                          <Power className="w-4 h-4" />
                          <span>Disconnect Stream</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Extra Stats or Helper Panel */}
                <div className="bg-gray-900/30 border border-gray-800/60 rounded-2xl p-4 flex flex-col gap-2 font-mono text-xs text-gray-400">
                  <div className="flex items-center justify-between">
                    <span>Handshake Type:</span>
                    <span className="text-emerald-400 font-sans">SDP Offer / Answer</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>ICE Configuration:</span>
                    <span className="text-gray-300">Google STUN server</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Role ID:</span>
                    <span className="text-gray-300 text-[10px]">{myWatcherIdRef.current || 'unassigned'}</span>
                  </div>
                </div>
              </div>

              {/* Right Media Viewing Panel */}
              <div className="md:col-span-8 flex flex-col gap-5">
                
                {/* Watcher Connection Status */}
                <div className="bg-gray-900/50 border border-gray-800 rounded-2xl p-4 flex items-center justify-between shadow-xl">
                  <div className="flex items-center gap-3">
                    <div className={`w-3 h-3 rounded-full ${
                      watcherStatus.connectionState === 'connected' ? 'bg-emerald-500 animate-pulse' :
                      watcherStatus.connectionState === 'connecting' ? 'bg-amber-400 animate-bounce' :
                      watcherStatus.connectionState === 'streamer-offline' ? 'bg-orange-500' : 'bg-gray-600'
                    }`} />
                    <div>
                      <div className="text-sm font-semibold text-white">
                        {watcherStatus.connectionState === 'connected' ? 'Stream Linked successfully' :
                         watcherStatus.connectionState === 'connecting' ? 'Establishing Handshake...' :
                         watcherStatus.connectionState === 'streamer-offline' ? 'Streamer is Offline' :
                         watcherStatus.connectionState === 'error' ? 'Handshake Failed' : 'Ready to Connect'}
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {watcherStatus.connectionState === 'connected' ? 'Secured via direct peer-to-peer tunnels' :
                         watcherStatus.connectionState === 'connecting' ? 'Waiting on SDP negotiation payload...' :
                         watcherStatus.connectionState === 'streamer-offline' ? 'Waiting for the streamer to start broadcasting' :
                         'Enter Stream ID and passcode on the left'}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Video Monitor */}
                <div className="bg-[#0e121e] border border-gray-800 rounded-2xl aspect-video relative flex items-center justify-center overflow-hidden shadow-2xl">
                  
                  {/* Actual Stream Video Element */}
                  <video 
                    ref={watcherVideoRef}
                    autoPlay 
                    playsInline 
                    className={`w-full h-full object-contain bg-[#07090f] transition-opacity duration-300 ${
                      watcherStatus.connectionState === 'connected' ? 'opacity-100' : 'opacity-0'
                    }`}
                  />

                  {/* Sandbox Overlays */}
                  {watcherStatus.connectionState !== 'connected' && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center z-10 bg-[#0e121e]">
                      {watcherStatus.connectionState === 'connecting' ? (
                        <>
                          <div className="w-12 h-12 rounded-full border-4 border-emerald-500/20 border-t-emerald-400 animate-spin mb-4" />
                          <h4 className="text-white font-bold text-sm">Negotiating P2P Handshake</h4>
                          <p className="text-xs text-gray-400 mt-2 max-w-xs">
                            Syncing codecs, local ICE vectors, and negotiating direct signaling lines...
                          </p>
                        </>
                      ) : watcherStatus.connectionState === 'streamer-offline' ? (
                        <>
                          <div className="w-14 h-14 rounded-full bg-orange-500/10 text-orange-400 flex items-center justify-center mb-4">
                            <ShieldAlert className="w-6 h-6 animate-pulse" />
                          </div>
                          <h4 className="text-white font-bold text-sm">Streamer is Offline</h4>
                          <p className="text-xs text-gray-400 mt-2 max-w-sm leading-relaxed">
                            Connected to Room, but the streamer is currently idle. We will sync automatically once their feed turns alive.
                          </p>
                        </>
                      ) : (
                        <>
                          <div className="w-14 h-14 rounded-full bg-gray-800/40 flex items-center justify-center mb-4 text-gray-500">
                            <Tv className="w-7 h-7" />
                          </div>
                          <h4 className="text-white font-bold text-sm">Television Dashboard</h4>
                          <p className="text-xs text-gray-400 mt-2 max-w-sm leading-relaxed">
                            Once you connect with valid Room credentials, the streamer's active broadcast will play right here.
                          </p>
                        </>
                      )}
                    </div>
                  )}

                  {/* Live Controls Bar on video hover */}
                  {watcherStatus.connectionState === 'connected' && (
                    <div className="absolute bottom-4 right-4 flex items-center gap-2 bg-[#0c101c]/80 backdrop-blur-md border border-gray-700/40 rounded-lg p-1 px-2 shadow-lg">
                      <button 
                        onClick={toggleMute}
                        className="p-1.5 rounded text-gray-300 hover:text-white hover:bg-gray-800 transition"
                        title={isMuted ? "Unmute" : "Mute"}
                      >
                        {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                      </button>
                      
                      <button 
                        onClick={toggleFullscreen}
                        className="p-1.5 rounded text-gray-300 hover:text-white hover:bg-gray-800 transition"
                        title="Toggle Fullscreen"
                      >
                        <Maximize className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>

                {watcherStatus.errorMessage && (
                  <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-xl p-4 flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 shrink-0" />
                    <div>
                      <h4 className="text-sm font-semibold">Connection Failed</h4>
                      <p className="text-xs mt-1 leading-relaxed">{watcherStatus.errorMessage}</p>
                    </div>
                  </div>
                )}

              </div>
            </motion.div>
          )}
        </AnimatePresence>

      </main>

      {/* Footer Details */}
      <footer className="border-t border-gray-900 bg-[#06080d]/60 py-4 px-6 relative z-10 mt-auto">
        <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-center justify-between gap-3 text-xs text-gray-500">
          <p>© 2026 Screen Share Room. Built via high-performance signaling.</p>
          <div className="flex gap-4 font-mono">
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              STUN Node Active
            </span>
            <span>Secure WebRTC TLS</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
