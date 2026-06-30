import { Redirect, type Href } from 'expo-router';

export default function PrototypeScreen() {
  return <Redirect href={'/chat' as Href} />;
}
