import { createContext, useContext } from 'react';
import { StyleSheet } from 'react-native';
import { DarkTheme, NavigationContainer } from '@react-navigation/native';
import {
  createNativeStackNavigator,
  type NativeStackScreenProps,
} from '@react-navigation/native-stack';
import type { RealtimeModel } from '@xmaxai/react-native-sdk';
import type {
  ConfigurationStore,
  SavedConfiguration,
  XLabApiEndpoint,
} from '../configuration/ConfigurationStore';
import {
  environmentForEndpoint,
  endpointForLocale,
} from '../configuration/ConfigurationStore';
import { useLocalization } from '../localization/LocalizationProvider';
import { FeedScreen } from '../screens/FeedScreen';
import { CameraScreen } from '../screens/CameraScreen';
import { RealtimeScreen } from '../screens/RealtimeScreen';
import { StorageScreen } from '../screens/StorageScreen';
import { useRealtimeEntryReady } from './useRealtimeEntryReady';

/** Navigation state contains input selection, while credentials stay in context. */
export type XLabStackParamList = {
  Feed: undefined;
  Camera: {
    endpoint: XLabApiEndpoint;
    model: RealtimeModel;
  };
  Image: {
    endpoint: XLabApiEndpoint;
    model: RealtimeModel;
    fileURL: string;
    customTrajectory: boolean;
    contentType: string | undefined;
  };
  External: {
    endpoint: XLabApiEndpoint;
    model: RealtimeModel;
    fileURL: string;
  };
  Storage: { endpoint: XLabApiEndpoint };
};

interface ConfigurationContextValue {
  configuration: SavedConfiguration;
  store: ConfigurationStore;
}

const ConfigurationContext = createContext<ConfigurationContextValue | null>(
  null,
);
const Stack = createNativeStackNavigator<XLabStackParamList>();

function useXLabConfiguration() {
  const value = useContext(ConfigurationContext);

  if (!value) throw new Error('XLab configuration provider is missing');

  return value;
}

/** Remains mounted beneath feature screens, preserving the ScrollView offset. */
function FeedRoute({
  navigation,
}: NativeStackScreenProps<XLabStackParamList, 'Feed'>) {
  const { configuration, store } = useXLabConfiguration();
  const { locale } = useLocalization();
  const currentEndpoint = endpointForLocale(locale);
  const model = configuration.model;

  return (
    <FeedScreen
      configuration={configuration}
      onAPIKeyChange={value => store.setKey(currentEndpoint, value)}
      onLanguageChange={value => store.selectLanguage(value)}
      onModelChange={value => store.selectModel(value)}
      onRetrySave={() => {
        void store.flush();
      }}
      onCamera={(_apiKey, endpoint) => {
        if (navigation.isFocused())
          navigation.navigate('Camera', {
            endpoint,
            model,
          });
      }}
      onImage={(_apiKey, endpoint, fileURL, customTrajectory, contentType) => {
        if (navigation.isFocused())
          navigation.navigate('Image', {
            endpoint,
            model,
            fileURL,
            customTrajectory,
            contentType,
          });
      }}
      onExternalVideo={(_apiKey, endpoint, fileURL) => {
        if (navigation.isFocused())
          navigation.navigate('External', {
            endpoint,
            fileURL,
            model,
          });
      }}
      onStorage={(_apiKey, endpoint) => {
        if (navigation.isFocused())
          navigation.navigate('Storage', { endpoint });
      }}
    />
  );
}

function CameraRoute({
  route,
  navigation,
}: NativeStackScreenProps<XLabStackParamList, 'Camera'>) {
  const { configuration } = useXLabConfiguration();
  const entryReady = useRealtimeEntryReady(navigation);

  return (
    <CameraScreen
      entryReady={entryReady}
      model={route.params.model}
      apiKey={configuration.keys[route.params.endpoint].trim()}
      environment={environmentForEndpoint(route.params.endpoint)}
      onBack={navigation.goBack}
    />
  );
}

function ImageRoute({
  route,
  navigation,
}: NativeStackScreenProps<XLabStackParamList, 'Image'>) {
  const { configuration } = useXLabConfiguration();
  const entryReady = useRealtimeEntryReady(navigation);

  return (
    <RealtimeScreen
      entryReady={entryReady}
      model={route.params.model}
      apiKey={configuration.keys[route.params.endpoint].trim()}
      environment={environmentForEndpoint(route.params.endpoint)}
      fileURL={route.params.fileURL}
      customTrajectory={route.params.customTrajectory}
      imageContentType={route.params.contentType}
      onBack={navigation.goBack}
    />
  );
}

/** Keeps the external source bound to this route's lifecycle and selected environment. */
function ExternalRoute({
  route,
  navigation,
}: NativeStackScreenProps<XLabStackParamList, 'External'>) {
  const { configuration } = useXLabConfiguration();
  const entryReady = useRealtimeEntryReady(navigation);
  return (
    <RealtimeScreen
      entryReady={entryReady}
      model={route.params.model}
      apiKey={configuration.keys[route.params.endpoint].trim()}
      environment={environmentForEndpoint(route.params.endpoint)}
      externalFileURL={route.params.fileURL}
      onBack={navigation.goBack}
    />
  );
}

function StorageRoute({
  route,
  navigation,
}: NativeStackScreenProps<XLabStackParamList, 'Storage'>) {
  const { configuration } = useXLabConfiguration();

  return (
    <StorageScreen
      apiKey={configuration.keys[route.params.endpoint].trim()}
      environment={environmentForEndpoint(route.params.endpoint)}
      onBack={navigation.goBack}
    />
  );
}

/** Owns the native page stack without recreating route components on app updates. */
export function XLabNavigator(props: ConfigurationContextValue) {
  return (
    <ConfigurationContext.Provider value={props}>
      <NavigationContainer theme={DarkTheme}>
        <Stack.Navigator
          initialRouteName="Feed"
          screenOptions={{
            headerShown: false,
            headerBackButtonMenuEnabled: false,
            orientation: 'default',
            contentStyle: styles.content,
            animation: 'slide_from_right',
            gestureEnabled: true,
          }}
        >
          <Stack.Screen name="Feed" component={FeedRoute} />
          <Stack.Screen name="Camera" component={CameraRoute} />
          <Stack.Screen name="Image" component={ImageRoute} />
          <Stack.Screen name="External" component={ExternalRoute} />
          <Stack.Screen name="Storage" component={StorageRoute} />
        </Stack.Navigator>
      </NavigationContainer>
    </ConfigurationContext.Provider>
  );
}

const styles = StyleSheet.create({
  content: { backgroundColor: '#000' },
});
