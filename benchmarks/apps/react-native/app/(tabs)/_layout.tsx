import { Tabs } from 'expo-router';
import React from 'react';
import { SVGIcon } from '@/components/SVGIcon';
import { Colors } from '@/constants/colors';
import HomeIcon from '@/assets/icons/home.svg';
import HomeSolidIcon from '@/assets/icons/home-solid.svg';
import HeartIcon from '@/assets/icons/heart.svg';
import HeartSolidIcon from '@/assets/icons/heart-solid.svg';
import { TextSize } from '@/constants/font';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Platform } from 'react-native';

export default function TabLayout() {
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: Colors.tabBarActive,
        tabBarInactiveTintColor: Colors.tabBarInactive,
        tabBarLabelStyle: TextSize.xs,
        tabBarStyle: {
          ...(Platform.OS === 'android' && { height: 64 + insets.bottom }),
          elevation: 0,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Pokédex',
          tabBarButtonTestID: 'tab_home',
          tabBarIcon: ({ color, size, focused }) => (
            <SVGIcon icon={focused ? HomeSolidIcon : HomeIcon} size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="favourites"
        options={{
          title: 'Favourites',
          tabBarButtonTestID: 'tab_favorites',
          tabBarIcon: ({ color, size, focused }) => (
            <SVGIcon icon={focused ? HeartSolidIcon : HeartIcon} size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
