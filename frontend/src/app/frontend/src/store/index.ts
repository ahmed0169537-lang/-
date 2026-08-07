import { configureStore } from '@reduxjs/toolkit';
import authReducer from './slices/authSlice';
import postsReducer from './slices/postsSlice';
import messagesReducer from './slices/messagesSlice';
import notificationsReducer from './slices/notificationsSlice';
import uiReducer from './slices/uiSlice';
import storiesReducer from './slices/storiesSlice';

export const store = configureStore({
  reducer: {
    auth: authReducer,
    posts: postsReducer,
    messages: messagesReducer,
    notifications: notificationsReducer,
    ui: uiReducer,
    stories: storiesReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: false,
    }),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
