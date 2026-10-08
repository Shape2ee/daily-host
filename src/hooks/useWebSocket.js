import {useCallback, useEffect, useRef, useState} from "react";

export const useWebSocket = (url, onMessageReceived) => {
  const socketRef = useRef(null);
  const [isConnected, setIsConnected] = useState(false);
  
  useEffect(() => {
    //'ws://localhost:8000'
    const socket = new WebSocket(url);
    socketRef.current = socket;
    
    socket.onopen = () => {
      console.log('연결 완료!')
      setIsConnected(true);
    }
    
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (onMessageReceived) {
        onMessageReceived(message);
      }
    };
    
    socket.onerror = (error) => {
      console.error('웹 소 켓 에 러 :', error);
      setIsConnected(false);
    };
    
    return () => {
      socket.close();
      setIsConnected(false);
    };
  }, [url])
  
  // 안전한 메시지 전송 함수
  const sendMessage = useCallback((data) => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(data));
    } else {
      console.warn('웹소켓이 아직 연결되지 않았습니다.');
    }
  }, []);
  
  return { socketRef, isConnected, sendMessage };
}