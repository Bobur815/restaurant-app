import type { NativeStackScreenProps } from '@react-navigation/native-stack';

export type RootStack = {
  Pin: undefined;
  Connect: undefined;
  Tables: undefined;
  Order: { tableNumber: number };
  Update: undefined;
};

export type ScreenProps<K extends keyof RootStack> = NativeStackScreenProps<RootStack, K>;
