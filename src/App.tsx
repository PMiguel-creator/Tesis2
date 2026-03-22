import React, { useState, useEffect, useRef } from 'react';
import { 
  onAuthStateChanged, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut, 
  User 
} from 'firebase/auth';
import { 
  collection, 
  addDoc, 
  onSnapshot, 
  query, 
  where, 
  orderBy, 
  Timestamp,
  deleteDoc,
  doc
} from 'firebase/firestore';
import { auth, db, storage } from './firebase';
import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage';
import type { AgentType } from './services/geminiService';
import {
  Brain,
  FileText,
  Upload,
  Trash2,
  LogOut,
  LogIn,
  Loader2,
  CheckCircle2,
  RotateCcw,
  Menu,
  X,
  ChevronRight,
  ArrowLeft
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';

// Error Handling Spec
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: any[];
  }
}

// Types
interface DocumentData {
  id: string;
  name: string;
  type: string;
  content?: string;       // legacy: base64 almacenado en Firestore
  storageUrl?: string;    // nuevo: URL de descarga de Firebase Storage
  storagePath?: string;   // nuevo: ruta en Firebase Storage para eliminar
  userId: string;
  createdAt: any;
}

interface AnalysisData {
  id: string;
  documentId: string;
  agentType: AgentType;
  result: string;
  userId: string;
  createdAt: any;
  usage?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}

// ── Correos con acceso de administrador ──────────────────────────────────────
const ADMIN_EMAILS = ['jeganag@gmail.com'];

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [documents, setDocuments] = useState<DocumentData[]>([]);
  const [analyses, setAnalyses] = useState<AnalysisData[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<DocumentData | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [activeAgent, setActiveAgent] = useState<AgentType>('classify_doc');
  const [customPrompt, setCustomPrompt] = useState('');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' ? window.innerWidth < 1024 : false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [showLanding, setShowLanding] = useState(true);
  const [logoClickCount, setLogoClickCount] = useState(0);
  const logoClickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Modal demo ────────────────────────────────────────────────────────────
  const [showDemoModal, setShowDemoModal] = useState(false);
  const [demoTab, setDemoTab] = useState<'wa' | 'form'>('wa');
  const [demoFormSent, setDemoFormSent] = useState(false);

  // ── Login form ────────────────────────────────────────────────────────────
  const [selectedRole, setSelectedRole] = useState<'contratista' | 'mandante' | ''>('');
  const [loginFormEmail, setLoginFormEmail] = useState('');
  const [loginFormError, setLoginFormError] = useState('');

  // ── Admin ─────────────────────────────────────────────────────────────────
  const [showAdminLogin, setShowAdminLogin] = useState(false);
  const [isAdminMode, setIsAdminMode] = useState(false);
  const [adminDocs, setAdminDocs] = useState<DocumentData[]>([]);
  const [adminAnalyses, setAdminAnalyses] = useState<AnalysisData[]>([]);
  const [adminError, setAdminError] = useState<string | null>(null);

  const handleFirestoreError = (error: unknown, operationType: OperationType, path: string | null) => {
    const message = error instanceof Error ? error.message : String(error);
    const errInfo: FirestoreErrorInfo = {
      error: message,
      authInfo: {
        userId: auth.currentUser?.uid,
        email: auth.currentUser?.email,
        emailVerified: auth.currentUser?.emailVerified,
        isAnonymous: auth.currentUser?.isAnonymous,
        tenantId: auth.currentUser?.tenantId,
        providerInfo: auth.currentUser?.providerData.map(provider => ({
          providerId: provider.providerId,
          displayName: provider.displayName,
          email: provider.email,
          photoUrl: provider.photoURL
        })) || []
      },
      operationType,
      path
    }
    console.error('Firestore Error: ', JSON.stringify(errInfo));
    setGlobalError(`Error (${operationType} en ${path}): ${message}`);
  };

  const testConnection = async () => {
    if (!user) return;
    setIsTestingConnection(true);
    setGlobalError(null);
    try {
      console.log("Testing Firestore connection...");
      const testRef = await addDoc(collection(db, 'documents'), {
        name: 'test-connection',
        type: 'text/plain',
        content: 'test',
        userId: user.uid,
        createdAt: new Date().toISOString(),
        isTest: true
      });
      console.log("Test write successful:", testRef.id);
      alert("¡Conexión exitosa! La base de datos está respondiendo.");
    } catch (error) {
      console.error("Test connection failed:", error);
      handleFirestoreError(error, OperationType.CREATE, 'documents (test)');
    } finally {
      setIsTestingConnection(false);
    }
  };

  // Handle resize for responsiveness
  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < 1024;
      setIsMobile(mobile);
      if (!mobile) setIsSidebarOpen(false);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const classification = analyses.find(a => a.documentId === selectedDoc?.id && a.agentType === 'classify_doc');
  const canExtract = !!classification;

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  // Data Listeners
  useEffect(() => {
    if (!user) {
      setDocuments([]);
      setAnalyses([]);
      return;
    }

    const docsQuery = query(
      collection(db, 'documents'),
      where('userId', '==', user.uid)
    );

    const analysesQuery = query(
      collection(db, 'analyses'),
      where('userId', '==', user.uid)
    );

    const unsubscribeDocs = onSnapshot(docsQuery, (snapshot) => {
      console.log(`Received ${snapshot.docs.length} documents from Firestore`);
      const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as DocumentData));
      setDocuments(docs);
    }, (error) => {
      console.error("onSnapshot documents error:", error);
      handleFirestoreError(error, OperationType.LIST, 'documents');
    });

    const unsubscribeAnalyses = onSnapshot(analysesQuery, (snapshot) => {
      console.log(`Received ${snapshot.docs.length} analyses from Firestore`);
      const results = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as AnalysisData));
      setAnalyses(results);
    }, (error) => {
      console.error("onSnapshot analyses error:", error);
      handleFirestoreError(error, OperationType.LIST, 'analyses');
    });

    return () => {
      unsubscribeDocs();
      unsubscribeAnalyses();
    };
  }, [user]);

  // Carga TODOS los documentos y análisis cuando el admin está autenticado
  // Requiere reglas Firestore que permitan lectura global para jeganag@gmail.com
  useEffect(() => {
    if (!user || !isAdminMode) return;

    const unsubDocs = onSnapshot(collection(db, 'documents'), (snapshot) => {
      setAdminDocs(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as DocumentData)));
    }, (err) => {
      setAdminError(`Sin permiso para ver todos los documentos. Verifica las reglas Firestore. (${err.message})`);
    });

    const unsubAnalyses = onSnapshot(collection(db, 'analyses'), (snapshot) => {
      setAdminAnalyses(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as AnalysisData)));
    }, () => {});

    return () => { unsubDocs(); unsubAnalyses(); };
  }, [user, isAdminMode]);

  // Llama al backend para analizar un documento con Gemini
  // El servidor descarga el archivo (sin restricciones CORS) y llama a la IA
  const analyzeViaServer = async (
    storageUrl: string | undefined,
    content: string | undefined,
    mimeType: string,
    agentType: AgentType,
    customPrompt?: string
  ): Promise<{ text: string; usage?: any }> => {
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storageUrl, content, mimeType, agentType, customPrompt }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: 'Error desconocido' }));
      throw new Error(err.error || 'Error al analizar el documento');
    }
    return response.json();
  };

  // Envía una alerta por correo cuando el análisis detecta algo relevante
  const sendAlertEmail = async (documentName: string, analysisResult: string) => {
    try {
      const response = await fetch('/api/send-alert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentName, analysisResult, userEmail: user?.email }),
      });
      if (response.ok) {
        console.log('Alerta enviada por correo para:', documentName);
      }
    } catch (error) {
      // No bloquear el flujo principal si falla el correo
      console.warn('No se pudo enviar alerta por correo:', error);
    }
  };

  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Login error:", error);
    }
  };

  const handleLogout = () => signOut(auth);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!user) {
      setGlobalError("Debes estar ingresado para subir archivos.");
      return;
    }

    const MAX_SIZE_MB = 10;
    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      setGlobalError(`El archivo es demasiado grande. Máximo ${MAX_SIZE_MB}MB.`);
      if (e.target) e.target.value = '';
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);
    setGlobalError(null);

    try {
      const storagePath = `documents/${user.uid}/${Date.now()}_${file.name}`;
      const storageRef = ref(storage, storagePath);
      const uploadTask = uploadBytesResumable(storageRef, file);

      uploadTask.on(
        'state_changed',
        (snapshot) => {
          const progress = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
          setUploadProgress(progress);
        },
        (error) => {
          console.error("Error al subir a Storage:", error);
          setGlobalError(`Error al subir archivo: ${error.message}`);
          setIsUploading(false);
          setUploadProgress(0);
          if (e.target) e.target.value = '';
        },
        async () => {
          try {
            const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
            const docRef = await addDoc(collection(db, 'documents'), {
              name: file.name,
              type: file.type,
              storageUrl: downloadURL,
              storagePath,
              userId: user.uid,
              createdAt: new Date().toISOString(),
            });
            console.log("Documento guardado con ID:", docRef.id);
          } catch (error: any) {
            console.error("Error al guardar metadatos en Firestore:", error);
            setGlobalError(`Error al guardar documento: ${error.message}`);
            handleFirestoreError(error, OperationType.CREATE, 'documents');
          } finally {
            setIsUploading(false);
            setUploadProgress(0);
            if (e.target) e.target.value = '';
          }
        }
      );
    } catch (error) {
      console.error("Error inesperado en upload:", error);
      setIsUploading(false);
      setUploadProgress(0);
      if (e.target) e.target.value = '';
    }
  };

  const handleDeleteDoc = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const docToDelete = documents.find(d => d.id === id);
      if (docToDelete?.storagePath) {
        try {
          await deleteObject(ref(storage, docToDelete.storagePath));
        } catch (storageError) {
          console.warn("No se pudo eliminar de Storage (puede no existir):", storageError);
        }
      }
      await deleteDoc(doc(db, 'documents', id));
      if (selectedDoc?.id === id) setSelectedDoc(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `documents/${id}`);
    }
  };

  const handleReset = async () => {
    if (!selectedDoc || !user) return;

    const analysesToDelete = analyses.filter(a => a.documentId === selectedDoc.id);
    
    try {
      await Promise.all(analysesToDelete.map(a => deleteDoc(doc(db, 'analyses', a.id))));
      setActiveAgent('classify_doc');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'analyses');
    }
  };

  const handleAnalyze = async (agentToUse?: AgentType) => {
    const agent = agentToUse || activeAgent;
    if (!selectedDoc || !user) return;

    setIsAnalyzing(true);
    try {
      // El análisis se hace en el servidor para evitar restricciones CORS con Firebase Storage
      const analysisResult = await analyzeViaServer(
        selectedDoc.storageUrl,
        selectedDoc.content,
        selectedDoc.type,
        agent,
        agent === 'custom' ? customPrompt : undefined
      );

      try {
        await addDoc(collection(db, 'analyses'), {
          documentId: selectedDoc.id,
          agentType: agent,
          result: analysisResult.text,
          usage: analysisResult.usage || null,
          userId: user.uid,
          createdAt: Timestamp.now().toDate().toISOString()
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, 'analyses');
      }

      // Enviar alerta si el análisis detecta un problema
      if (agent === 'review_result') {
        const texto = analysisResult.text.toUpperCase();
        const necesitaAlerta = texto.includes('NO APROBADO') || texto.includes('VENCIDA');
        if (necesitaAlerta) {
          await sendAlertEmail(selectedDoc.name, analysisResult.text);
        }
      }
    } catch (error: any) {
      console.error("Analysis error:", error);
      setGlobalError(`Error al analizar: ${error?.message || 'Error desconocido'}`);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const currentAnalysis = analyses.find(a => a.documentId === selectedDoc?.id && a.agentType === activeAgent);

  // Triple-clic en logo → pantalla de acceso admin (Phase 3)
  const handleLogoClick = () => {
    if (logoClickTimer.current) clearTimeout(logoClickTimer.current);
    const next = logoClickCount + 1;
    setLogoClickCount(next);
    if (next >= 3) {
      setLogoClickCount(0);
      setShowAdminLogin(true);
      setAdminError(null);
    } else {
      logoClickTimer.current = setTimeout(() => setLogoClickCount(0), 600);
    }
  };

  // Login restringido al panel de administración
  const handleAdminLogin = async () => {
    setAdminError(null);
    const provider = new GoogleAuthProvider();
    try {
      const result = await signInWithPopup(auth, provider);
      if (ADMIN_EMAILS.includes(result.user.email || '')) {
        setIsAdminMode(true);
        setShowAdminLogin(false);
      } else {
        await signOut(auth);
        setAdminError('Acceso denegado. Esta cuenta no tiene privilegios de administrador.');
      }
    } catch (error) {
      console.error('Admin login error:', error);
      setAdminError('Error al iniciar sesión. Inténtalo nuevamente.');
    }
  };

  // Salir del modo admin
  const handleAdminLogout = async () => {
    setIsAdminMode(false);
    setAdminDocs([]);
    setAdminAnalyses([]);
    setAdminError(null);
    await signOut(auth);
  };

  // ── PANTALLA DE LOGIN ADMIN ───────────────────────────────────────────────
  if (showAdminLogin) {
    return (
      <div style={{ minHeight: '100vh', background: '#060B14', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Inter', system-ui, sans-serif" }}>
        <div style={{ width: 420, textAlign: 'center', padding: '0 24px' }}>
          {/* Badge restringido */}
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 32,
            background: 'rgba(220,38,38,0.12)', border: '1px solid rgba(220,38,38,0.3)',
            borderRadius: 20, padding: '5px 14px', fontSize: 11, fontWeight: 700, color: '#FCA5A5', letterSpacing: '0.06em'
          }}>
            🔒 ACCESO RESTRINGIDO
          </div>

          {/* Logo */}
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}>
            <div style={{
              width: 60, height: 60, background: '#1E293B', borderRadius: 14,
              border: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28
            }}>🗺️</div>
          </div>

          <h1 style={{ fontSize: 26, fontWeight: 900, color: '#fff', margin: '0 0 8px' }}>AtlasOps Admin</h1>
          <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.35)', margin: '0 0 40px', lineHeight: 1.6 }}>
            Panel de administración. Solo personal autorizado puede acceder.
          </p>

          {/* Error */}
          {adminError && (
            <div style={{
              background: 'rgba(220,38,38,0.1)', border: '1px solid rgba(220,38,38,0.3)',
              borderRadius: 8, padding: '12px 16px', marginBottom: 20, fontSize: 13, color: '#FCA5A5', textAlign: 'left'
            }}>
              ⚠️ {adminError}
            </div>
          )}

          {/* Botón login */}
          <button
            onClick={handleAdminLogin}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              padding: '13px 20px', background: '#DC2626', color: '#fff', border: 'none',
              borderRadius: 8, fontSize: 15, fontWeight: 700, cursor: 'pointer',
              boxShadow: '0 4px 16px rgba(220,38,38,0.3)'
            }}
          >
            <LogIn size={18} />
            Ingresar con Google
          </button>

          <button
            onClick={() => { setShowAdminLogin(false); setAdminError(null); }}
            style={{ marginTop: 20, background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)', fontSize: 13, cursor: 'pointer' }}
          >
            ← Volver al sitio
          </button>
        </div>
      </div>
    );
  }

  if (!isAuthReady) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#060B14' }}>
        <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
      </div>
    );
  }

  // ── PANEL DE ADMINISTRACIÓN ───────────────────────────────────────────────
  if (isAdminMode && user) {
    const uniqueUserIds = [...new Set(adminDocs.map(d => d.userId))];
    const docsLast24h = adminDocs.filter(d => {
      try { return (Date.now() - new Date(d.createdAt).getTime()) < 86400000; } catch { return false; }
    }).length;

    return (
      <div style={{ minHeight: '100vh', background: '#F9FAFB', fontFamily: "'Inter', system-ui, sans-serif" }}>
        {/* Topbar admin */}
        <div style={{
          height: 56, background: '#0F172A', display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', padding: '0 28px', position: 'sticky', top: 0, zIndex: 50,
          borderBottom: '2px solid #DC2626'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 32, height: 32, background: '#DC2626', borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>🗺️</div>
            <span style={{ color: '#fff', fontWeight: 800, fontSize: 16 }}>AtlasOps</span>
            <div style={{
              background: 'rgba(220,38,38,0.2)', border: '1px solid rgba(220,38,38,0.4)',
              borderRadius: 20, padding: '2px 10px', fontSize: 10, fontWeight: 700, color: '#FCA5A5', letterSpacing: '0.08em'
            }}>ADMIN</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <img src={user.photoURL || ''} alt="" style={{ width: 28, height: 28, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.2)' }} referrerPolicy="no-referrer" />
              <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', fontWeight: 500 }}>{user.email}</span>
            </div>
            <button
              onClick={handleAdminLogout}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px',
                background: 'rgba(220,38,38,0.15)', border: '1px solid rgba(220,38,38,0.3)',
                borderRadius: 7, fontSize: 12, fontWeight: 700, color: '#FCA5A5', cursor: 'pointer'
              }}
            >
              <LogOut size={13} /> Salir
            </button>
          </div>
        </div>

        <div style={{ padding: '28px 32px', maxWidth: 1200, margin: '0 auto' }}>
          {/* Título */}
          <div style={{ marginBottom: 24 }}>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: '#111827', margin: '0 0 4px' }}>Panel de Administración</h1>
            <p style={{ fontSize: 13, color: '#9CA3AF' }}>Vista global de actividad en la plataforma AtlasOps</p>
          </div>

          {/* Error Firestore */}
          {adminError && (
            <div style={{
              background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8,
              padding: '12px 16px', marginBottom: 20, fontSize: 13, color: '#DC2626'
            }}>
              ⚠️ {adminError}
            </div>
          )}

          {/* Stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 28 }}>
            {[
              { label: 'Usuarios registrados', value: uniqueUserIds.length, icon: '👥', color: '#2563EB', bg: '#EFF6FF', border: '#BFDBFE' },
              { label: 'Documentos totales', value: adminDocs.length, icon: '📄', color: '#16A34A', bg: '#F0FDF4', border: '#BBF7D0' },
              { label: 'Análisis realizados', value: adminAnalyses.length, icon: '🤖', color: '#7C3AED', bg: '#F5F3FF', border: '#DDD6FE' },
              { label: 'Docs últimas 24h', value: docsLast24h, icon: '⚡', color: '#D97706', bg: '#FFFBEB', border: '#FDE68A' },
            ].map(s => (
              <div key={s.label} style={{
                background: '#fff', borderRadius: 10, border: `1px solid ${s.border}`,
                padding: '18px 20px', borderLeft: `4px solid ${s.color}`
              }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontSize: 12, color: '#6B7280', fontWeight: 500 }}>{s.label}</span>
                  <span style={{ fontSize: 20 }}>{s.icon}</span>
                </div>
                <div style={{ fontSize: 32, fontWeight: 900, color: s.color }}>{s.value}</div>
              </div>
            ))}
          </div>

          {/* Tabla de documentos */}
          <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #E5E7EB', overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #F3F4F6', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <h2 style={{ fontSize: 15, fontWeight: 700, color: '#111827', margin: 0 }}>Todos los Documentos</h2>
                <p style={{ fontSize: 12, color: '#9CA3AF', margin: '2px 0 0' }}>{adminDocs.length} documentos en la plataforma</p>
              </div>
            </div>
            {adminDocs.length === 0 ? (
              <div style={{ padding: '48px', textAlign: 'center', color: '#9CA3AF', fontSize: 14 }}>
                {adminError ? 'No se pudieron cargar los documentos (ver error arriba)' : 'Cargando documentos…'}
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: '#F9FAFB' }}>
                      {['Documento', 'Tipo', 'Usuario (UID)', 'Fecha', 'Análisis'].map(h => (
                        <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '1px solid #E5E7EB' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {adminDocs.slice().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).map((d, i) => {
                      const docAnalyses = adminAnalyses.filter(a => a.documentId === d.id).length;
                      return (
                        <tr key={d.id} style={{ borderBottom: '1px solid #F3F4F6', background: i % 2 === 0 ? '#fff' : '#FAFAFA' }}>
                          <td style={{ padding: '12px 16px', color: '#111827', fontWeight: 600, maxWidth: 200 }}>
                            <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</div>
                          </td>
                          <td style={{ padding: '12px 16px' }}>
                            <span style={{ background: '#EFF6FF', color: '#2563EB', padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600 }}>
                              {d.type.split('/')[1]?.toUpperCase() || 'DOC'}
                            </span>
                          </td>
                          <td style={{ padding: '12px 16px', color: '#6B7280', fontFamily: 'monospace', fontSize: 11 }}>
                            {d.userId.slice(0, 14)}…
                          </td>
                          <td style={{ padding: '12px 16px', color: '#9CA3AF', fontSize: 12 }}>
                            {(() => { try { return new Date(d.createdAt).toLocaleDateString('es-CL'); } catch { return '—'; } })()}
                          </td>
                          <td style={{ padding: '12px 16px' }}>
                            <span style={{
                              background: docAnalyses > 0 ? '#F0FDF4' : '#F3F4F6',
                              color: docAnalyses > 0 ? '#16A34A' : '#9CA3AF',
                              padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600
                            }}>
                              {docAnalyses} {docAnalyses === 1 ? 'análisis' : 'análisis'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    // ── LANDING PAGE ──────────────────────────────────────────────────
    if (showLanding) {
      return (
        <div className="min-h-screen" style={{ background: '#0F172A', fontFamily: "'Inter', system-ui, sans-serif" }}>
          {/* Navbar */}
          <nav style={{
            position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100, height: 64,
            background: 'rgba(15,23,42,0.95)', backdropFilter: 'blur(8px)',
            borderBottom: '1px solid rgba(255,255,255,0.07)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 6%'
          }}>
            <div
              style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'default', userSelect: 'none' }}
              onClick={handleLogoClick}
            >
              <div style={{
                width: 38, height: 38, background: '#2563EB', borderRadius: 9,
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20
              }}>🗺️</div>
              <span style={{ fontSize: 20, fontWeight: 800, color: '#fff' }}>AtlasOps</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 13, color: 'rgba(255,255,255,.5)' }}>Gestión de Fuerza Laboral Tercerizada</span>
              <button
                onClick={() => setShowLanding(false)}
                style={{
                  padding: '8px 20px', background: '#2563EB', color: '#fff', border: 'none',
                  borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer'
                }}
              >
                Iniciar sesión
              </button>
            </div>
          </nav>

          {/* Hero */}
          <section style={{
            minHeight: '100vh', paddingTop: 120, paddingBottom: 80, paddingLeft: '6%', paddingRight: '6%',
            background: 'linear-gradient(160deg,#0F172A 0%,#1E3A5F 45%,#0891B2 100%)',
            display: 'flex', alignItems: 'center', position: 'relative', overflow: 'hidden'
          }}>
            {/* glow decorativo */}
            <div style={{
              position: 'absolute', top: '-40%', right: '-20%', width: 700, height: 700,
              background: 'radial-gradient(circle,rgba(37,99,235,.25) 0%,transparent 70%)',
              pointerEvents: 'none'
            }} />
            <div style={{ maxWidth: 1200, margin: '0 auto', width: '100%', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 60, alignItems: 'center' }}>
              {/* Columna izquierda */}
              <div>
                <div style={{
                  display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 20,
                  background: 'rgba(37,99,235,.25)', border: '1px solid rgba(37,99,235,.4)',
                  borderRadius: 20, padding: '5px 14px', fontSize: 12, fontWeight: 600, color: '#93C5FD'
                }}>
                  ⚡ Plataforma SaaS con Agentes IA
                </div>
                <h1 style={{ fontSize: 44, fontWeight: 900, color: '#fff', lineHeight: 1.15, marginBottom: 22, margin: '0 0 22px' }}>
                  Gestión inteligente de{' '}
                  <span style={{ color: '#60A5FA' }}>fuerza laboral tercerizada</span>
                </h1>
                <p style={{ fontSize: 17, color: 'rgba(255,255,255,.72)', lineHeight: 1.7, marginBottom: 36, maxWidth: 520 }}>
                  AtlasOps automatiza la revisión y validación de documentos laborales de sus contratistas mediante agentes de Inteligencia Artificial. Cumpla la Ley de Subcontratación sin papeleo, sin errores y en tiempo real.
                </p>
                <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                  <button
                    onClick={() => setShowLanding(false)}
                    style={{
                      padding: '14px 28px', background: '#2563EB', color: '#fff', border: 'none',
                      borderRadius: 9, fontSize: 15, fontWeight: 700, cursor: 'pointer',
                      boxShadow: '0 4px 20px rgba(37,99,235,.4)'
                    }}
                  >
                    Iniciar sesión →
                  </button>
                  <button
                    onClick={() => { setShowDemoModal(true); setDemoTab('wa'); setDemoFormSent(false); }}
                    style={{
                      padding: '14px 28px', background: 'rgba(255,255,255,.08)', color: '#fff',
                      border: '1.5px solid rgba(255,255,255,.2)', borderRadius: 9, fontSize: 15, fontWeight: 600, cursor: 'pointer'
                    }}
                  >
                    Solicitar demo
                  </button>
                </div>
                {/* Stats */}
                <div style={{ display: 'flex', gap: 32, marginTop: 40 }}>
                  {[
                    { val: '70%', lbl: 'Reducción carga\nadministrativa' },
                    { val: '<2 min', lbl: 'Análisis por\nagente IA' },
                    { val: '100%', lbl: 'Cumplimiento\nLey 20.123' },
                  ].map(s => (
                    <div key={s.val}>
                      <div style={{ fontSize: 28, fontWeight: 900, color: '#fff' }}>{s.val}</div>
                      <div style={{ fontSize: 12, color: 'rgba(255,255,255,.5)', marginTop: 2, whiteSpace: 'pre-line' }}>{s.lbl}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Columna derecha — tarjeta de métricas */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {[
                  { icon: '🤖', label: 'Agentes IA activos', val: '4 agentes', color: '#3B82F6' },
                  { icon: '📄', label: 'Documentos procesados hoy', val: '147 docs', color: '#10B981' },
                  { icon: '✅', label: 'Tasa de aprobación', val: '94.2%', color: '#8B5CF6' },
                  { icon: '⚡', label: 'Tiempo promedio análisis', val: '1.8 min', color: '#F59E0B' },
                ].map(m => (
                  <div key={m.label} style={{
                    background: 'rgba(255,255,255,.06)', borderRadius: 12,
                    border: '1px solid rgba(255,255,255,.1)', padding: '16px 20px',
                    display: 'flex', alignItems: 'center', gap: 16
                  }}>
                    <div style={{
                      width: 44, height: 44, borderRadius: 10,
                      background: `${m.color}22`, border: `1px solid ${m.color}44`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0
                    }}>{m.icon}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, color: 'rgba(255,255,255,.5)', marginBottom: 2 }}>{m.label}</div>
                      <div style={{ fontSize: 18, fontWeight: 700, color: '#fff' }}>{m.val}</div>
                    </div>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: m.color, boxShadow: `0 0 8px ${m.color}` }} />
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* ── MODAL SOLICITAR DEMO ── */}
          {showDemoModal && (
            <div
              onClick={(e) => { if (e.target === e.currentTarget) setShowDemoModal(false); }}
              style={{
                position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
                backdropFilter: 'blur(4px)', zIndex: 999,
                display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16
              }}
            >
              <div style={{ background: '#fff', borderRadius: 18, width: '100%', maxWidth: 520, boxShadow: '0 24px 64px rgba(0,0,0,0.2)', overflow: 'hidden' }}>
                {/* Header */}
                <div style={{ background: 'linear-gradient(135deg,#0F172A,#1E3A5F)', padding: '28px 28px 24px', position: 'relative' }}>
                  <h2 style={{ fontSize: 22, fontWeight: 800, color: '#fff', margin: '0 0 6px' }}>Solicitar una demo</h2>
                  <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.6)', margin: 0 }}>Elija cómo prefiere contactarnos y le mostramos AtlasOps en acción.</p>
                  <button
                    onClick={() => setShowDemoModal(false)}
                    style={{
                      position: 'absolute', top: 16, right: 18, background: 'rgba(255,255,255,0.1)',
                      border: 'none', color: '#fff', width: 30, height: 30, borderRadius: '50%',
                      fontSize: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center'
                    }}
                  >✕</button>
                </div>

                {/* Tabs */}
                <div style={{ display: 'flex', borderBottom: '1px solid #E5E7EB' }}>
                  {(['wa', 'form'] as const).map(tab => (
                    <button
                      key={tab}
                      onClick={() => setDemoTab(tab)}
                      style={{
                        flex: 1, padding: '14px', fontSize: 14, fontWeight: 700, border: 'none',
                        background: '#fff', cursor: 'pointer',
                        color: demoTab === tab ? '#2563EB' : '#9CA3AF',
                        borderBottom: demoTab === tab ? '3px solid #2563EB' : '3px solid transparent',
                        transition: 'all .15s'
                      }}
                    >
                      {tab === 'wa' ? '💬 WhatsApp' : '📋 Formulario'}
                    </button>
                  ))}
                </div>

                {/* Body */}
                <div style={{ padding: '24px 28px 28px' }}>
                  {/* Panel WhatsApp */}
                  {demoTab === 'wa' && (
                    <div style={{ textAlign: 'center', padding: '8px 0' }}>
                      <div style={{ fontSize: 48, marginBottom: 16 }}>💬</div>
                      <h3 style={{ fontSize: 18, fontWeight: 800, color: '#111827', margin: '0 0 10px' }}>Contáctenos por WhatsApp</h3>
                      <p style={{ fontSize: 14, color: '#6B7280', lineHeight: 1.6, margin: '0 0 24px', maxWidth: 360, marginLeft: 'auto', marginRight: 'auto' }}>
                        Escríbanos directamente y un ejecutivo de AtlasOps le agendará una demo personalizada a la brevedad.
                      </p>
                      <a
                        href="https://wa.me/56912345678?text=Hola%2C%20me%20interesa%20conocer%20AtlasOps.%20%C2%BFPodemos%20agendar%20una%20demo%3F"
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 8,
                          padding: '12px 28px', background: '#25D366', color: '#fff',
                          borderRadius: 9, fontSize: 15, fontWeight: 700, textDecoration: 'none',
                          boxShadow: '0 4px 14px rgba(37,211,102,0.35)'
                        }}
                      >
                        💬 Abrir WhatsApp
                      </a>
                      <p style={{ fontSize: 12, color: '#9CA3AF', marginTop: 16 }}>
                        Horario de atención: Lunes a Viernes · 9:00 – 18:00 hrs (Santiago, Chile)
                      </p>
                    </div>
                  )}

                  {/* Panel Formulario */}
                  {demoTab === 'form' && (
                    demoFormSent ? (
                      <div style={{ textAlign: 'center', padding: '16px 0' }}>
                        <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
                        <h3 style={{ fontSize: 18, fontWeight: 800, color: '#111827', margin: '0 0 8px' }}>¡Solicitud enviada!</h3>
                        <p style={{ fontSize: 14, color: '#6B7280', lineHeight: 1.6 }}>Nos contactaremos con usted en menos de 24 horas hábiles para agendar la demo.</p>
                      </div>
                    ) : (
                      <div>
                        {[
                          { label: 'Nombre completo', type: 'text', placeholder: 'Ej: María González' },
                          { label: 'Empresa', type: 'text', placeholder: 'Ej: Codelco División Norte' },
                          { label: 'Cargo', type: 'text', placeholder: 'Ej: Gerente de Operaciones' },
                          { label: 'Correo electrónico', type: 'email', placeholder: 'correo@empresa.cl' },
                        ].map(f => (
                          <div key={f.label} style={{ marginBottom: 12 }}>
                            <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#374151', marginBottom: 4 }}>{f.label}</label>
                            <input type={f.type} placeholder={f.placeholder} style={{ width: '100%', padding: '10px 13px', border: '1.5px solid #E5E7EB', borderRadius: 8, fontSize: 13.5, color: '#111827', outline: 'none', boxSizing: 'border-box' }} />
                          </div>
                        ))}
                        <div style={{ marginBottom: 12 }}>
                          <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#374151', marginBottom: 4 }}>¿Cuántos contratistas gestiona actualmente?</label>
                          <select style={{ width: '100%', padding: '10px 13px', border: '1.5px solid #E5E7EB', borderRadius: 8, fontSize: 13.5, color: '#111827', outline: 'none' }}>
                            <option value="">Seleccione…</option>
                            <option>Menos de 10</option>
                            <option>10 – 50</option>
                            <option>50 – 200</option>
                            <option>Más de 200</option>
                          </select>
                        </div>
                        <div style={{ marginBottom: 18 }}>
                          <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#374151', marginBottom: 4 }}>Mensaje (opcional)</label>
                          <textarea placeholder="Cuéntenos su desafío o necesidad específica…" rows={3} style={{ width: '100%', padding: '10px 13px', border: '1.5px solid #E5E7EB', borderRadius: 8, fontSize: 13.5, color: '#111827', outline: 'none', resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box' }} />
                        </div>
                        <button
                          onClick={() => setDemoFormSent(true)}
                          style={{ width: '100%', padding: '12px', background: '#2563EB', color: '#fff', border: 'none', borderRadius: 8, fontSize: 15, fontWeight: 700, cursor: 'pointer' }}
                        >
                          Enviar solicitud →
                        </button>
                      </div>
                    )
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      );
    }

    // ── LOGIN PAGE ────────────────────────────────────────────────────
    return (
      <div className="min-h-screen flex" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
        {/* Panel izquierdo — marca */}
        <div style={{
          flex: 1, background: 'linear-gradient(160deg,#0F172A 0%,#1E3A5F 50%,#0891B2 100%)',
          display: 'flex', flexDirection: 'column', justifyContent: 'center',
          padding: 60, position: 'relative', overflow: 'hidden'
        }}>
          <div style={{
            position: 'absolute', top: '-30%', left: '-20%', width: 500, height: 500,
            background: 'radial-gradient(circle,rgba(37,99,235,.2) 0%,transparent 70%)',
            pointerEvents: 'none'
          }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 48 }}>
            <div style={{
              width: 44, height: 44, background: '#2563EB', borderRadius: 10,
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22
            }}>🗺️</div>
            <span style={{ fontSize: 24, fontWeight: 800, color: '#fff' }}>AtlasOps</span>
          </div>
          <h1 style={{ fontSize: 36, fontWeight: 900, color: '#fff', lineHeight: 1.2, margin: '0 0 20px' }}>
            La plataforma que <span style={{ color: '#60A5FA' }}>gestiona</span> su fuerza laboral tercerizada
          </h1>
          <p style={{ fontSize: 15, color: 'rgba(255,255,255,.6)', lineHeight: 1.7, margin: '0 0 40px' }}>
            Agentes IA que analizan, validan y ejecutan sobre documentos laborales en tiempo real. Cumpla la Ley de Subcontratación sin esfuerzo manual.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {[
              { icon: '🤖', text: 'Análisis semántico automático de documentos' },
              { icon: '🔐', text: 'Datos encriptados y aislados por empresa' },
              { icon: '⚡', text: 'Resultados en menos de 2 minutos' },
              { icon: '📊', text: 'Dashboard de cumplimiento en tiempo real' },
            ].map(f => (
              <div key={f.text} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 8, background: 'rgba(255,255,255,.08)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0
                }}>{f.icon}</div>
                <span style={{ fontSize: 13.5, color: 'rgba(255,255,255,.7)' }}>{f.text}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Panel derecho — formulario */}
        <div style={{
          width: 480, display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '40px 48px', background: '#fff', flexShrink: 0
        }}>
          <div style={{ width: '100%', maxWidth: 380 }}>
            {/* Volver */}
            <button
              onClick={() => { setShowLanding(true); setLoginFormError(''); }}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13,
                color: '#6B7280', background: 'none', border: 'none', padding: 0,
                cursor: 'pointer', marginBottom: 32
              }}
            >
              <ArrowLeft size={14} /> Volver al sitio
            </button>

            <h2 style={{ fontSize: 26, fontWeight: 800, color: '#111827', margin: '0 0 6px' }}>Bienvenido</h2>
            <p style={{ fontSize: 14, color: '#6B7280', margin: '0 0 28px', lineHeight: 1.5 }}>
              Ingrese sus credenciales para acceder a su portal
            </p>

            {/* Error */}
            {loginFormError && (
              <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 7, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: '#DC2626' }}>
                {loginFormError}
              </div>
            )}

            {/* Tipo de acceso */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
                Tipo de acceso
              </label>
              <select
                value={selectedRole}
                onChange={e => { setSelectedRole(e.target.value as any); setLoginFormError(''); }}
                style={{
                  width: '100%', padding: '10px 12px', border: '1px solid #D1D5DB',
                  borderRadius: 7, fontSize: 14, color: selectedRole ? '#111827' : '#9CA3AF',
                  background: '#fff', cursor: 'pointer', outline: 'none',
                  appearance: 'auto'
                }}
              >
                <option value="">Seleccione su perfil…</option>
                <option value="contratista">Contratista</option>
                <option value="mandante">Mandante</option>
              </select>
            </div>

            {/* Correo */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
                Correo electrónico
              </label>
              <input
                type="email"
                value={loginFormEmail}
                onChange={e => setLoginFormEmail(e.target.value)}
                placeholder="usuario@empresa.cl"
                style={{
                  width: '100%', padding: '10px 12px', border: '1px solid #D1D5DB',
                  borderRadius: 7, fontSize: 14, color: '#111827', outline: 'none',
                  boxSizing: 'border-box'
                }}
              />
            </div>

            {/* Contraseña */}
            <div style={{ marginBottom: 24 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
                Contraseña
              </label>
              <input
                type="password"
                placeholder="••••••••"
                style={{
                  width: '100%', padding: '10px 12px', border: '1px solid #D1D5DB',
                  borderRadius: 7, fontSize: 14, color: '#111827', outline: 'none',
                  boxSizing: 'border-box'
                }}
              />
            </div>

            {/* Botón ingresar */}
            <button
              onClick={() => {
                if (!selectedRole) {
                  setLoginFormError('Seleccione su tipo de acceso para continuar.');
                  return;
                }
                setLoginFormError('');
                handleLogin();
              }}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                gap: 10, padding: '12px 20px', background: '#2563EB', color: '#fff',
                border: 'none', borderRadius: 8, fontSize: 15, fontWeight: 700, cursor: 'pointer',
                boxShadow: '0 2px 8px rgba(37,99,235,0.3)'
              }}
            >
              <LogIn size={17} />
              Ingresar al portal →
            </button>

            {/* Footer */}
            <div style={{ marginTop: 24, paddingTop: 20, borderTop: '1px solid #F3F4F6', textAlign: 'center' }}>
              <p style={{ fontSize: 12, color: '#9CA3AF', margin: '0 0 6px' }}>
                ¿No tiene cuenta?{' '}
                <span style={{ color: '#2563EB', cursor: 'pointer', fontWeight: 600 }}>Solicite acceso aquí</span>
              </p>
              <p style={{ fontSize: 12, color: '#9CA3AF', margin: 0 }}>
                ¿Olvidó su contraseña?{' '}
                <span style={{ color: '#2563EB', cursor: 'pointer', fontWeight: 600 }}>Recuperar contraseña</span>
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 flex flex-col lg:flex-row overflow-hidden">
      {/* Error Banner */}
      <AnimatePresence>
        {globalError && (
          <motion.div 
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="fixed top-0 left-0 right-0 z-[100] bg-red-500 text-white p-4 text-center text-sm font-bold flex flex-col sm:flex-row items-center justify-center gap-4"
          >
            <div className="flex items-center gap-2">
              <X className="w-5 h-5 shrink-0" />
              <span>{globalError}</span>
            </div>
            <div className="flex items-center gap-2">
              <button 
                onClick={() => window.location.reload()} 
                className="px-3 py-1 bg-white/20 hover:bg-white/30 rounded text-xs transition-colors"
              >
                Recargar App
              </button>
              <button onClick={() => setGlobalError(null)} className="p-1 hover:bg-white/20 rounded">
                <X className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mobile Header */}
      <div className="lg:hidden flex items-center justify-between p-4 sticky top-0 z-50" style={{ background: '#0F172A', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        <div className="flex items-center gap-2" onClick={handleLogoClick} style={{ cursor: 'default', userSelect: 'none' }}>
          <div style={{ width: 32, height: 32, background: '#2563EB', borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>🗺️</div>
          <span className="font-bold tracking-tight" style={{ color: '#fff', fontSize: 16 }}>AtlasOps</span>
        </div>
        <button
          onClick={() => setIsSidebarOpen(!isSidebarOpen)}
          className="p-2 rounded-lg transition-colors"
          style={{ color: 'rgba(255,255,255,0.6)' }}
        >
          {isSidebarOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>

      {/* Mobile Overlay */}
      <AnimatePresence>
        {isSidebarOpen && isMobile && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsSidebarOpen(false)}
            className="fixed inset-0 bg-zinc-900/20 backdrop-blur-sm z-30 lg:hidden"
          />
        )}
      </AnimatePresence>

      {/* Sidebar - Document List */}
      <AnimatePresence>
        {(isSidebarOpen || !isMobile) && (
          <motion.aside
            initial={isMobile ? { x: -320 } : false}
            animate={{ x: 0 }}
            exit={{ x: -320 }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className={`fixed inset-y-0 left-0 z-40 w-[230px] flex flex-col lg:relative lg:translate-x-0 ${isSidebarOpen ? 'shadow-2xl' : ''}`}
            style={{ background: '#0F172A', borderRight: '1px solid rgba(255,255,255,0.07)' }}
          >
            {/* Logo */}
            <div
              className="hidden lg:flex items-center justify-between"
              style={{ padding: '22px 20px 18px', borderBottom: '1px solid rgba(255,255,255,0.07)', cursor: 'default', userSelect: 'none' }}
              onClick={handleLogoClick}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 36, height: 36, background: '#2563EB', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>🗺️</div>
                <div>
                  <span style={{ color: '#fff', fontWeight: 700, fontSize: 17 }}>AtlasOps</span>
                  <small style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10, display: 'block' }}>Gestión Laboral IA</small>
                </div>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); handleLogout(); }}
                style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.35)', cursor: 'pointer', padding: 4, borderRadius: 6 }}
                title="Cerrar sesión"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>

            {/* Upload */}
            <div style={{ padding: '14px 12px 10px' }}>
              <button
                onClick={() => {
                  fileInputRef.current?.click();
                  if (window.innerWidth < 1024) setIsSidebarOpen(false);
                }}
                disabled={isUploading}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  background: '#2563EB', color: '#fff', border: 'none', borderRadius: 8,
                  padding: '10px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                  opacity: isUploading ? 0.6 : 1, transition: 'background .15s'
                }}
              >
                {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {isUploading && uploadProgress > 0 ? `Subiendo ${uploadProgress}%` : 'Subir Documento'}
              </button>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileUpload}
                className="hidden"
                accept=".pdf,.txt,.doc,.docx,image/*"
              />
            </div>

            {/* Doc list */}
            <div className="flex-1 overflow-y-auto no-scrollbar" style={{ padding: '0 8px' }}>
              <p style={{ padding: '12px 12px 6px', color: 'rgba(255,255,255,0.3)', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>
                Documentos Recientes
              </p>
              {documents.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 16px' }}>
                  <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 10px' }}>
                    <FileText className="w-5 h-5" style={{ color: 'rgba(255,255,255,0.2)' }} />
                  </div>
                  <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', fontWeight: 500 }}>No hay documentos aún</p>
                </div>
              ) : (
                documents.map((document) => (
                  <button
                    key={document.id}
                    onClick={() => {
                      setSelectedDoc(document);
                      if (window.innerWidth < 1024) setIsSidebarOpen(false);
                    }}
                    style={{
                      width: '100%', textAlign: 'left', padding: '9px 12px', borderRadius: 7,
                      display: 'flex', alignItems: 'center', gap: 10, border: 'none', cursor: 'pointer',
                      background: selectedDoc?.id === document.id ? '#2563EB' : 'transparent',
                      transition: 'background .15s', marginBottom: 2
                    }}
                    onMouseEnter={e => { if (selectedDoc?.id !== document.id) (e.currentTarget as HTMLButtonElement).style.background = '#1E293B'; }}
                    onMouseLeave={e => { if (selectedDoc?.id !== document.id) (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
                    className="group"
                  >
                    <div style={{
                      width: 30, height: 30, borderRadius: 7, flexShrink: 0,
                      background: selectedDoc?.id === document.id ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.07)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center'
                    }}>
                      <FileText className="w-4 h-4" style={{ color: selectedDoc?.id === document.id ? '#fff' : 'rgba(255,255,255,0.45)' }} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 13, fontWeight: 600, color: selectedDoc?.id === document.id ? '#fff' : 'rgba(255,255,255,0.75)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {document.name}
                      </p>
                      <p style={{ fontSize: 10, color: selectedDoc?.id === document.id ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                        {document.type.split('/')[1] || 'DOC'}
                      </p>
                    </div>
                    <Trash2
                      onClick={(e) => handleDeleteDoc(document.id, e)}
                      className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity"
                      style={{ color: 'rgba(255,100,100,0.8)', flexShrink: 0 }}
                    />
                  </button>
                ))
              )}
            </div>

            {/* Footer — user + debug */}
            <div style={{ padding: '12px 14px', borderTop: '1px solid rgba(255,255,255,0.07)' }}>
              <div style={{ marginBottom: 10, padding: '8px 10px', background: 'rgba(255,255,255,0.04)', borderRadius: 7, fontFamily: 'monospace', fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>
                <p>UID: {user.uid.slice(0, 12)}…</p>
                <p>Docs: {documents.length} · Análisis: {analyses.length}</p>
                <button
                  onClick={testConnection}
                  disabled={isTestingConnection}
                  style={{ marginTop: 6, width: '100%', padding: '4px 8px', background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: 5, fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.5)', cursor: 'pointer' }}
                >
                  {isTestingConnection ? 'Probando…' : 'Probar Conexión'}
                </button>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ position: 'relative', flexShrink: 0 }}>
                  <img
                    src={user.photoURL || ''}
                    alt={user.displayName || ''}
                    style={{ width: 34, height: 34, borderRadius: '50%', objectFit: 'cover', border: '2px solid rgba(255,255,255,0.15)' }}
                    referrerPolicy="no-referrer"
                  />
                  <div style={{ position: 'absolute', bottom: -1, right: -1, width: 10, height: 10, background: '#10B981', borderRadius: '50%', border: '2px solid #0F172A' }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 12.5, fontWeight: 600, color: 'rgba(255,255,255,0.9)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.displayName}</p>
                  <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.email}</p>
                </div>
                <button
                  onClick={handleLogout}
                  className="lg:hidden"
                  style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.35)', cursor: 'pointer' }}
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden relative">
        {selectedDoc ? (
          <>
            {/* Header / Agent Selector */}
            <header className="bg-white border-b border-zinc-200 p-4 lg:p-6 sticky top-0 z-30">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0" style={{ background: '#2563EB' }}>
                    <FileText className="w-6 h-6 text-white" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-xl font-bold text-zinc-900 truncate leading-tight">{selectedDoc.name}</h2>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest bg-zinc-100 px-2 py-0.5 rounded-md">{selectedDoc.type.split('/')[1] || 'document'}</span>
                      <span className="text-[10px] text-zinc-300">•</span>
                      <span className="text-[10px] text-zinc-400 font-medium">Subido el {new Date(selectedDoc.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                </div>
                
                <div className="flex items-center gap-2 lg:gap-3">
                  <button
                    onClick={handleReset}
                    className="flex-1 lg:flex-none flex items-center justify-center gap-2 py-2.5 px-5 rounded-lg font-bold text-sm transition-all active:scale-95"
                    style={{ background: '#F3F4F6', color: '#4B5563', border: '1px solid #E5E7EB' }}
                  >
                    <RotateCcw className="w-4 h-4" />
                    <span className="hidden sm:inline">Reiniciar</span>
                  </button>

                  {activeAgent === 'classify_doc' ? (
                    <button
                      onClick={() => handleAnalyze('classify_doc')}
                      disabled={isAnalyzing}
                      className="flex-[2] lg:flex-none flex items-center justify-center gap-2 py-2.5 px-6 rounded-lg font-bold text-sm transition-all active:scale-95 disabled:opacity-50"
                      style={{ background: '#2563EB', color: '#fff', border: 'none', boxShadow: '0 2px 8px rgba(37,99,235,0.3)' }}
                    >
                      {isAnalyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                      1. Identificar
                    </button>
                  ) : (
                    <button
                      onClick={() => handleAnalyze()}
                      disabled={isAnalyzing || !canExtract}
                      className="flex-[2] lg:flex-none flex items-center justify-center gap-2 py-2.5 px-6 rounded-lg font-bold text-sm transition-all active:scale-95 disabled:opacity-50"
                      style={{ background: '#2563EB', color: '#fff', border: 'none', boxShadow: '0 2px 8px rgba(37,99,235,0.3)' }}
                    >
                      {isAnalyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Brain className="w-4 h-4" />}
                      2. Analizar
                    </button>
                  )}
                </div>
              </div>

              <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar -mx-4 px-4 lg:mx-0 lg:px-0">
                {(['classify_doc', 'review_result', 'doc_data', 'json_output', 'custom'] as AgentType[]).map((type) => (
                  <button
                    key={type}
                    onClick={() => setActiveAgent(type)}
                    disabled={type !== 'classify_doc' && !canExtract}
                    className="whitespace-nowrap px-5 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                    style={activeAgent === type
                      ? { background: '#2563EB', color: '#fff', border: '1px solid #2563EB' }
                      : { background: '#fff', color: '#6B7280', border: '1px solid #E5E7EB' }
                    }
                  >
                    {type === 'classify_doc' && '1. Identificación'}
                    {type === 'review_result' && '2. Revisión'}
                    {type === 'doc_data' && '2. Datos'}
                    {type === 'json_output' && '2. JSON'}
                    {type === 'custom' && '2. Consultas'}
                  </button>
                ))}
              </div>

              {activeAgent === 'custom' && (
                <motion.div 
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-4"
                >
                  <textarea
                    value={customPrompt}
                    onChange={(e) => setCustomPrompt(e.target.value)}
                    placeholder="Escribe tu instrucción personalizada para el agente..."
                    className="w-full p-4 rounded-2xl border-2 border-zinc-100 text-sm focus:border-zinc-900 outline-none transition-all bg-zinc-50/50"
                    rows={2}
                  />
                </motion.div>
              )}
            </header>

            {/* Analysis Result */}
            <div className="flex-1 overflow-y-auto p-4 lg:p-10 bg-zinc-50/30">
              <AnimatePresence mode="wait">
                {isAnalyzing ? (
                  <motion.div 
                    key="analyzing"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="flex flex-col items-center justify-center h-full text-zinc-400 py-20"
                  >
                    <div className="relative mb-6">
                      <div className="absolute inset-0 bg-zinc-900/5 rounded-full animate-ping"></div>
                      <div className="relative w-20 h-20 bg-white rounded-3xl shadow-xl flex items-center justify-center border border-zinc-100">
                        <Loader2 className="w-10 h-10 animate-spin text-zinc-900" />
                      </div>
                    </div>
                    <h3 className="text-lg font-bold text-zinc-900 mb-1">Analizando Documento</h3>
                    <p className="text-sm font-medium text-zinc-400">Nuestros agentes están procesando la información...</p>
                  </motion.div>
                ) : currentAnalysis ? (
                  <motion.div 
                    key="result"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="max-w-4xl mx-auto"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
                      <div className="flex items-center gap-3 text-emerald-600 bg-emerald-50 w-fit px-4 py-2 rounded-2xl border border-emerald-100 shadow-sm">
                        <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
                        <span className="text-xs font-bold uppercase tracking-widest">Análisis Completado</span>
                      </div>
                      
                      {currentAnalysis.usage && (
                        <div className="flex items-center gap-4 px-4 py-2 bg-white rounded-2xl border border-zinc-100 shadow-sm">
                          <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Tokens:</span>
                          <div className="flex items-center gap-3 text-[10px] font-mono font-bold">
                            <span className="text-zinc-400">In: <span className="text-zinc-900">{currentAnalysis.usage.promptTokenCount}</span></span>
                            <span className="text-zinc-400">Out: <span className="text-zinc-900">{currentAnalysis.usage.candidatesTokenCount}</span></span>
                            <div className="w-px h-3 bg-zinc-200 mx-1"></div>
                            <span className="text-zinc-900">Total: {currentAnalysis.usage.totalTokenCount}</span>
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="bg-white p-6 lg:p-12 rounded-[2.5rem] shadow-xl shadow-zinc-200/50 border border-zinc-100 relative overflow-hidden">
                      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-zinc-900 via-zinc-400 to-zinc-900 opacity-10"></div>
                      <div className="prose prose-zinc prose-sm lg:prose-base max-w-none prose-headings:font-bold prose-headings:tracking-tight prose-p:text-zinc-600 prose-p:leading-relaxed prose-strong:text-zinc-900 prose-code:bg-zinc-50 prose-code:p-1 prose-code:rounded-md prose-code:text-zinc-900 prose-code:before:content-none prose-code:after:content-none">
                        <ReactMarkdown>{currentAnalysis.result}</ReactMarkdown>
                      </div>
                    </div>
                  </motion.div>
                ) : (
                  <motion.div 
                    key="empty"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex flex-col items-center justify-center h-full text-zinc-300 py-20"
                  >
                    <div style={{ width: 72, height: 72, background: '#EFF6FF', borderRadius: 16, border: '1px solid #BFDBFE', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16, fontSize: 30 }}>
                      🤖
                    </div>
                    <h3 className="text-lg font-bold mb-1" style={{ color: '#111827' }}>Listo para Analizar</h3>
                    <p className="text-sm text-center max-w-xs" style={{ color: '#9CA3AF' }}>Selecciona un agente arriba y haz clic en el botón para comenzar el análisis.</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-6 lg:p-12" style={{ background: '#F9FAFB' }}>
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="max-w-2xl w-full text-center"
            >
              {/* Logo central */}
              <div className="relative inline-block mb-8">
                <div style={{ width: 80, height: 80, background: '#EFF6FF', borderRadius: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto', border: '1px solid #BFDBFE' }}>
                  <span style={{ fontSize: 36 }}>🗺️</span>
                </div>
              </div>

              <h1 className="text-2xl lg:text-3xl font-bold mb-3 tracking-tight leading-tight" style={{ color: '#111827' }}>
                Bienvenido a <span style={{ color: '#2563EB' }}>AtlasOps</span>
              </h1>
              <p className="text-base mb-10 max-w-lg mx-auto leading-relaxed" style={{ color: '#6B7280' }}>
                Sube un documento laboral y utiliza los agentes de IA para clasificarlo, revisar su vigencia y extraer datos relevantes.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-left mb-10">
                {[
                  { icon: '🔍', title: 'Clasificación Automática', desc: 'Identifica el tipo de documento y su relevancia para el cumplimiento de la Ley 20.123.', color: '#EFF6FF', border: '#BFDBFE', iconBg: '#2563EB' },
                  { icon: '✅', title: 'Revisión de Vigencia', desc: 'Detecta documentos vencidos, observaciones y estado de aprobación en tiempo real.', color: '#F0FDF4', border: '#BBF7D0', iconBg: '#16A34A' },
                  { icon: '📋', title: 'Extracción de Datos', desc: 'Extrae RUTs, fechas, montos y nombres con alta precisión desde PDFs e imágenes.', color: '#FFFBEB', border: '#FDE68A', iconBg: '#D97706' },
                  { icon: '🤖', title: 'Consultas Personalizadas', desc: 'Formula cualquier pregunta sobre el documento y el agente IA responde en segundos.', color: '#F5F3FF', border: '#DDD6FE', iconBg: '#7C3AED' },
                ].map(card => (
                  <div key={card.title} style={{ padding: '20px 22px', borderRadius: 10, background: card.color, border: `1px solid ${card.border}` }}>
                    <div style={{ width: 38, height: 38, borderRadius: 8, background: card.iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, marginBottom: 12 }}>{card.icon}</div>
                    <h3 style={{ fontSize: 13, fontWeight: 700, color: '#111827', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{card.title}</h3>
                    <p style={{ fontSize: 12, color: '#6B7280', lineHeight: 1.6 }}>{card.desc}</p>
                  </div>
                ))}
              </div>

              <div className="flex flex-col items-center gap-3">
                <button
                  onClick={() => setIsSidebarOpen(true)}
                  className="lg:hidden flex items-center gap-2 py-3 px-8 rounded-lg font-bold text-sm active:scale-95 transition-all"
                  style={{ background: '#2563EB', color: '#fff', border: 'none', boxShadow: '0 2px 10px rgba(37,99,235,0.3)' }}
                >
                  <Upload className="w-4 h-4" />
                  Subir primer documento
                </button>
                <div className="hidden lg:flex items-center gap-2" style={{ color: '#9CA3AF' }}>
                  <ChevronRight className="w-4 h-4 animate-bounce rotate-90" />
                  <span style={{ fontSize: 12, fontWeight: 500 }}>Sube un documento en el panel lateral para comenzar</span>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </main>
    </div>
  );
}
