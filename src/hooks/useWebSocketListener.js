// useWebSocketListener.js
import { useEffect } from 'react';
import { useWebSocketContext } from '../components/WebSocketContext/WebSocketContext.jsx'

export const useWebSocketListener = (targetType, onMessageReceived) => {
  const { subscribe } = useWebSocketContext();
  
  useEffect(() => {
    // 메시지가 올 때 targetType과 일치하는 경우에만 콜백 실행
    const unsubscribe = subscribe((message) => {
      if (message.type === targetType) {
        onMessageReceived(message);
      }
    });
    
    return () => unsubscribe(); // 컴포넌트 언마운트 시 자동 구독 해제
  }, [targetType, onMessageReceived, subscribe]);
};