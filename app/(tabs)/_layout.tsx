import { SymbolView } from 'expo-symbols';
import { Tabs } from 'expo-router';

import { MiraDesign, shadow } from '@/constants/Design';

export const unstable_settings = {
  initialRouteName: 'more',
};

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: MiraDesign.color.primary,
        tabBarInactiveTintColor: MiraDesign.color.muted,
        tabBarItemStyle: {
          paddingVertical: 7,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '800',
        },
        tabBarStyle: {
          backgroundColor: MiraDesign.color.surface,
          borderRadius: 34,
          borderTopWidth: 0,
          bottom: 14,
          height: 68,
          left: 18,
          position: 'absolute',
          right: 18,
          ...shadow,
        },
      }}>
      <Tabs.Screen
        name="more"
        options={{
          title: 'Systems',
          tabBarIcon: ({ color }) => (
            <SymbolView name={{ ios: 'ellipsis.circle.fill', android: 'menu', web: 'menu' }} tintColor={color} size={27} />
          ),
        }}
      />
    </Tabs>
  );
}
