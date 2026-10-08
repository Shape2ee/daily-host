import {createContext, useCallback, useContext, useEffect, useRef, useState} from "react";
import {
  WS_RETRY_INITIAL_MS,
  WS_RETRY_MAX_MS,
  WS_URL,
} from "../../constants/webSocket.js";

const WebSocketContext = createContext(null);

export const WebSocketProvider = ({ children }) => {
  const socketRef = useRef(null);
  const listenersRef = useRef(new Set()); // 메시지 수신을 기다리는 콜백 함수들의 모음
  const [isConnected, setIsConnected] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(true);
  
  useEffect(() => {
    let cancelled = false;
    let retryTimer = null;
    let attempt = 0;

    const clearRetry = () => {
      if (retryTimer == null) return;
      window.clearTimeout(retryTimer);
      retryTimer = null;
    };

    const scheduleReconnect = () => {
      if (cancelled) return;
      setIsReconnecting(true);
      const delay = Math.min(
        WS_RETRY_INITIAL_MS * 2 ** attempt,
        WS_RETRY_MAX_MS,
      );
      attempt += 1;
      retryTimer = window.setTimeout(connect, delay);
    };

    const connect = () => {
      if (cancelled) return;
      clearRetry();

      const socket = new WebSocket(WS_URL);
      socketRef.current = socket;

      socket.onopen = () => {
        if (cancelled) {
          socket.close();
          return;
        }
        console.log('연 결 완 료 !');
        attempt = 0;
        setIsConnected(true);
        setIsReconnecting(false);
      };

      socket.onclose = () => {
        if (socketRef.current === socket) {
          socketRef.current = null;
        }
        setIsConnected(false);
        if (cancelled) return;
        console.log('연 결 종 료 ! 재연결 대기');
        scheduleReconnect();
      };

      socket.onerror = (error) => {
        console.error('웹소켓 에러:', error);
      };

      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          console.log('B가 받은 메시지:', message);
          listenersRef.current.forEach((listener) => listener(message));
        } catch (error) {
          console.error('WebSocket JSON Parse Error:', error);
        }
      };
    };

    connect();

    return () => {
      cancelled = true;
      clearRetry();
      const socket = socketRef.current;
      socketRef.current = null;
      if (socket && socket.readyState < WebSocket.CLOSING) {
        socket.close();
      }
      setIsConnected(false);
      setIsReconnecting(false);
    };
  }, [])
  
  // 메시지 수신 구독 함수
  const subscribe = useCallback((callback) => {
    listenersRef.current.add(callback);
    return () => listenersRef.current.delete(callback); // 구독 해제 함수 반환
  }, []);
  
  // 메시지 전송 함수
  const sendMessage = useCallback((data) => {
    console.log(data);
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(data));
    }
  }, []);
  
  return (
    <WebSocketContext.Provider value={{ isConnected, isReconnecting, sendMessage, subscribe }}>
      {children}
    </WebSocketContext.Provider>
  )
}

export const useWebSocketContext = () => useContext(WebSocketContext);
