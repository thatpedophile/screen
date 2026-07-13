export type AppRole = 'home' | 'streamer' | 'watcher';

export interface RoomCredentials {
  streamId: string;
  password?: string;
}

export type MediaSourceType = 'screen' | 'camera';

export interface StreamerStatus {
  isActive: boolean;
  watcherCount: number;
  selectedSource: MediaSourceType;
  audioEnabled: boolean;
  connectionState: 'idle' | 'connecting' | 'streaming' | 'error';
  errorMessage?: string;
}

export interface WatcherStatus {
  connectionState: 'idle' | 'connecting' | 'connected' | 'streamer-offline' | 'error' | 'disconnected';
  errorMessage?: string;
}

export interface SignalPayload {
  type: 'create_room' | 'join_room' | 'signal' | 'room_created' | 'room_joined' | 'watcher_joined' | 'watcher_left' | 'streamer_left' | 'error';
  streamId?: string;
  password?: string;
  watcherId?: string;
  targetId?: string;
  senderId?: string;
  signalData?: any;
  streamerActive?: boolean;
  message?: string;
}
