import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://sfihzieydbtjuibxhmzd.supabase.co'
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNmaWh6aWV5ZGJ0anVpYnhobXpkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTkwNzA0MDAsImV4cCI6MjA3NDY0NjQwMH0.8Vh8Q18jJnZcqbWZxJMdycj6wAp2DegLq-NK4eFJPvQ'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
