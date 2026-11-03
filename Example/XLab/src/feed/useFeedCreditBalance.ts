import { useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { AppState, Platform } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { XmaxEnvironment } from '@xmaxai/react-native-sdk';
import {
  FeedCreditBalancePoller,
  type FeedCreditBalanceState,
} from './FeedCreditBalance';

/** Refreshes credits only while the homepage is focused and the app is active. */
export function useFeedCreditBalance(
  apiKey: string,
  environment: XmaxEnvironment,
): FeedCreditBalanceState {
  const navigation = useNavigation();
  const [poller] = useState(() => new FeedCreditBalancePoller());
  const state = useSyncExternalStore(poller.subscribe, poller.getSnapshot);
  const key = apiKey.trim();

  useLayoutEffect(() => {
    let appActive = AppState.currentState === 'active';
    let focused = navigation.isFocused();
    let windowFocused = true;
    const update = () =>
      poller.update(key, environment, appActive && focused && windowFocused);
    const focus = navigation.addListener('focus', () => {
      focused = true;
      update();
    });
    const blur = navigation.addListener('blur', () => {
      focused = false;
      update();
    });
    const appState = AppState.addEventListener('change', value => {
      appActive = value === 'active';
      update();
    });
    // Android can lose interaction focus without changing AppState, such as in the notification drawer.
    const windowBlur =
      Platform.OS === 'android'
        ? AppState.addEventListener('blur', () => {
            windowFocused = false;
            update();
          })
        : null;
    const windowFocus =
      Platform.OS === 'android'
        ? AppState.addEventListener('focus', () => {
            windowFocused = true;
            update();
          })
        : null;
    update();

    return () => {
      focus();
      blur();
      appState.remove();
      windowBlur?.remove();
      windowFocus?.remove();
      poller.pause();
    };
  }, [environment, key, navigation, poller]);

  return state;
}
