import { DarkTheme, DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ToastProvider } from './components/Toast';
import { I18nProvider } from './i18n';
import type { RootStack } from './navigation';
import { ConnectScreen } from './screens/ConnectScreen';
import { OrderScreen } from './screens/OrderScreen';
import { PinScreen } from './screens/PinScreen';
import { TablesScreen } from './screens/TablesScreen';
import { UpdateScreen } from './screens/UpdateScreen';
import { AppStateProvider, useApp } from './state/app';
import { useTheme } from './theme';
import { ThemePreferenceProvider } from './theme/preference';

const Stack = createNativeStackNavigator<RootStack>();

function Root() {
  const { ready, user } = useApp();
  const { c, scheme } = useTheme();
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  if (!ready) return <View style={{ flex: 1, backgroundColor: c.bg }} />;
  return (
    <NavigationContainer
      theme={{ ...base, colors: { ...base.colors, background: c.bg, card: c.surface, text: c.text, border: c.border, primary: c.primary } }}
    >
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack.Navigator screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
        {user ? (
          // Signed in: the floor. Locking (or the till forgetting the sign-in) goes back to the PIN.
          <>
            <Stack.Screen name="Tables" component={TablesScreen} />
            <Stack.Screen name="Order" component={OrderScreen} />
          </>
        ) : (
          <Stack.Screen name="Pin" component={PinScreen} />
        )}
        <Stack.Screen name="Connect" component={ConnectScreen} />
        <Stack.Screen name="Update" component={UpdateScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemePreferenceProvider>
        <I18nProvider>
          <AppStateProvider>
            <ToastProvider>
              <Root />
            </ToastProvider>
          </AppStateProvider>
        </I18nProvider>
      </ThemePreferenceProvider>
    </SafeAreaProvider>
  );
}
