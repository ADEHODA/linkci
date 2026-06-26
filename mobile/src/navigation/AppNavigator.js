import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import { Ionicons } from '@expo/vector-icons';

import FeedScreen from '../screens/FeedScreen';
import ProfileScreen from '../screens/ProfileScreen';
import MessagingScreen from '../screens/MessagingScreen';
import BoursesScreen from '../screens/BoursesScreen';
import FormationsScreen from '../screens/FormationsScreen';
import NotificationsScreen from '../screens/NotificationsScreen';
import LoginScreen from '../screens/LoginScreen';
import RegisterScreen from '../screens/RegisterScreen';

const Stack = createStackNavigator();
const Tab = createBottomTabNavigator();

const ORANGE = '#FF6B35';

function HomeTabs({ onLogout }) {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ color, size }) => {
          const icons = {
            Feed: 'newspaper',
            Bourses: 'cash',
            Formations: 'school',
            Messages: 'chatbubbles',
            Notifications: 'notifications',
            Profil: 'person',
          };
          return <Ionicons name={icons[route.name]} size={size} color={color} />;
        },
        tabBarActiveTintColor: ORANGE,
        tabBarInactiveTintColor: '#9CA3AF',
        tabBarStyle: { paddingBottom: 4, height: 56 },
        headerStyle: { backgroundColor: ORANGE },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: '700' },
      })}
    >
      <Tab.Screen name="Feed" component={FeedScreen} options={{ title: 'Fil' }} />
      <Tab.Screen name="Bourses" component={BoursesScreen} options={{ title: 'Bourses' }} />
      <Tab.Screen name="Formations" component={FormationsScreen} options={{ title: 'Formations' }} />
      <Tab.Screen name="Messages" component={MessagingScreen} options={{ title: 'Messages' }} />
      <Tab.Screen name="Notifications" component={NotificationsScreen} options={{ title: 'Alertes' }} />
          <Tab.Screen name="Profil" options={{ title: 'Profil' }}>
            {(props) => <ProfileScreen {...props} onLogout={onLogout} />}
          </Tab.Screen>
    </Tab.Navigator>
  );
}

export default function AppNavigator({ token, onLogin, onLogout }) {
  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {token ? (
          <Stack.Screen name="Home">
            {() => <HomeTabs onLogout={onLogout} />}
          </Stack.Screen>
        ) : (
          <>
            <Stack.Screen name="Login">
              {(props) => <LoginScreen {...props} onLogin={onLogin} />}
            </Stack.Screen>
            <Stack.Screen name="Register">
              {(props) => <RegisterScreen {...props} onLogin={onLogin} />}
            </Stack.Screen>
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
