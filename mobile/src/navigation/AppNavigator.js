import React from 'react';
import { TouchableOpacity } from 'react-native';
import { NavigationContainer, DefaultTheme, DarkTheme, createNavigationContainerRef } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import { Ionicons } from '@expo/vector-icons';

import FeedScreen from '../screens/FeedScreen';
import ExploreScreen from '../screens/ExploreScreen';
import ProfileScreen from '../screens/ProfileScreen';
import MessagingScreen from '../screens/MessagingScreen';
import ConversationScreen from '../screens/ConversationScreen';
import StudentProfileScreen from '../screens/StudentProfileScreen';
import BoursesScreen from '../screens/BoursesScreen';
import FormationsScreen from '../screens/FormationsScreen';
import NotificationsScreen from '../screens/NotificationsScreen';
import CalendarScreen from '../screens/CalendarScreen';
import GroupsScreen from '../screens/GroupsScreen';
import DocumentsScreen from '../screens/DocumentsScreen';
import SearchScreen from '../screens/SearchScreen';
import EditProfileScreen from '../screens/EditProfileScreen';
import LoginScreen from '../screens/LoginScreen';
import RegisterScreen from '../screens/RegisterScreen';
import OpportunitesScreen from '../screens/OpportunitesScreen';
import AnnoncesScreen from '../screens/AnnoncesScreen';
import EntraideScreen from '../screens/EntraideScreen';
import QuestionScreen from '../screens/QuestionScreen';
import AdminScreen from '../screens/AdminScreen';
import ScannerScreen from '../screens/ScannerScreen';
import EmploiDuTempsScreen from '../screens/EmploiDuTempsScreen';
import SettingsScreen from '../screens/SettingsScreen';
import VerifyEmailScreen from '../screens/VerifyEmailScreen';
import OnboardingScreen from '../screens/OnboardingScreen';
import { useTheme } from '../theme';
import { useRealtime } from '../realtime';

// Pour naviguer hors des ecrans (ex. toucher une notification push)
export const navigationRef = createNavigationContainerRef();

const Stack = createStackNavigator();
const Tab = createBottomTabNavigator();

const TAB_ICONS = {
  Accueil: 'home',
  Explorer: 'compass',
  Messages: 'chatbubbles',
  Alertes: 'notifications',
  Profil: 'person',
};

const pastille = (n) => (n > 0 ? (n > 99 ? '99+' : n) : undefined);

function HomeTabs({ onLogout }) {
  const { compteurs } = useRealtime();
  const { colors, headerOptions } = useTheme();
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        ...headerOptions,
        tabBarIcon: ({ color, size, focused }) => (
          <Ionicons name={focused ? TAB_ICONS[route.name] : `${TAB_ICONS[route.name]}-outline`} size={size} color={color} />
        ),
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textFaint,
        tabBarStyle: { height: 62, paddingTop: 6, paddingBottom: 8, borderTopColor: colors.border, backgroundColor: colors.card },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        tabBarBadgeStyle: { backgroundColor: colors.danger, fontSize: 10, fontWeight: '800' },
      })}
    >
      <Tab.Screen
        name="Accueil"
        component={FeedScreen}
        options={({ navigation }) => ({
          title: 'LINK CI',
          tabBarLabel: 'Accueil',
          headerTitleStyle: { ...headerOptions.headerTitleStyle, color: colors.primary, fontWeight: '900', letterSpacing: 0.5 },
          headerRight: () => (
            <TouchableOpacity onPress={() => navigation.navigate('Search')} style={{ marginRight: 16 }} hitSlop={10}>
              <Ionicons name="search" size={22} color={colors.text} />
            </TouchableOpacity>
          ),
        })}
      />
      <Tab.Screen name="Explorer" component={ExploreScreen} />
      <Tab.Screen
        name="Messages"
        component={MessagingScreen}
        options={({ navigation }) => ({
          tabBarBadge: pastille(compteurs.messages),
          headerRight: () => (
            <TouchableOpacity onPress={() => navigation.navigate('Search')} style={{ marginRight: 16 }} hitSlop={10}>
              <Ionicons name="create-outline" size={24} color={colors.primary} />
            </TouchableOpacity>
          ),
        })}
      />
      <Tab.Screen name="Alertes" component={NotificationsScreen} options={{ title: 'Notifications', tabBarLabel: 'Alertes', tabBarBadge: pastille(compteurs.notifications) }} />
      <Tab.Screen name="Profil">
        {(props) => <ProfileScreen {...props} onLogout={onLogout} />}
      </Tab.Screen>
    </Tab.Navigator>
  );
}

export default function AppNavigator({ token, onLogin, onLogout, accueilVu }) {
  const { colors, sombre, headerOptions } = useTheme();
  const base = sombre ? DarkTheme : DefaultTheme;
  const navTheme = {
    ...base,
    colors: { ...base.colors, background: colors.bg, card: colors.card, text: colors.text, border: colors.border, primary: colors.primary },
  };
  return (
    <NavigationContainer ref={navigationRef} theme={navTheme}>
      <Stack.Navigator screenOptions={{ ...headerOptions, headerBackTitle: 'Retour' }}>
        {token ? (
          <>
            <Stack.Screen name="Home" options={{ headerShown: false }}>
              {() => <HomeTabs onLogout={onLogout} />}
            </Stack.Screen>
            <Stack.Screen name="Conversation" component={ConversationScreen} />
            <Stack.Screen name="ProfilEtudiant" component={StudentProfileScreen} options={{ title: 'Profil' }} />
            <Stack.Screen name="Bourses" component={BoursesScreen} />
            <Stack.Screen name="Opportunites" component={OpportunitesScreen} options={{ title: 'Stages & emplois' }} />
            <Stack.Screen name="Annonces" component={AnnoncesScreen} options={{ title: 'Petites annonces' }} />
            <Stack.Screen name="Entraide" component={EntraideScreen} />
            <Stack.Screen name="Question" component={QuestionScreen} options={{ title: 'Question' }} />
            <Stack.Screen name="Admin" component={AdminScreen} options={{ title: 'Administration' }} />
            <Stack.Screen name="Scanner" component={ScannerScreen} options={{ headerShown: false }} />
            <Stack.Screen name="EmploiDuTemps" component={EmploiDuTempsScreen} options={{ title: 'Emploi du temps' }} />
            <Stack.Screen name="Parametres" options={{ title: 'Parametres' }}>
              {(props) => <SettingsScreen {...props} onLogin={onLogin} onLogout={onLogout} />}
            </Stack.Screen>
            <Stack.Screen name="Formations" component={FormationsScreen} />
            <Stack.Screen name="Documents" component={DocumentsScreen} />
            <Stack.Screen name="Groupes" component={GroupsScreen} />
            <Stack.Screen name="Calendrier" component={CalendarScreen} />
            <Stack.Screen name="Search" component={SearchScreen} options={{ title: 'Recherche' }} />
            <Stack.Screen name="ModifierProfil" component={EditProfileScreen} options={{ title: 'Modifier le profil' }} />
          </>
        ) : (
          <>
            {/* premier lancement : ecrans de bienvenue avant la connexion */}
            {!accueilVu ? <Stack.Screen name="Bienvenue" component={OnboardingScreen} options={{ headerShown: false }} /> : null}
            <Stack.Screen name="Login" options={{ headerShown: false }}>
              {(props) => <LoginScreen {...props} onLogin={onLogin} />}
            </Stack.Screen>
            <Stack.Screen name="Register" options={{ headerShown: false }}>
              {(props) => <RegisterScreen {...props} onLogin={onLogin} />}
            </Stack.Screen>
            <Stack.Screen name="VerifierEmail" options={{ headerShown: false }}>
              {(props) => <VerifyEmailScreen {...props} onLogin={onLogin} />}
            </Stack.Screen>
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
