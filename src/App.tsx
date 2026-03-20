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
import { auth, db } from './firebase';
import { analyzeDocument, AgentType } from './services/geminiService';
import { 
  FileText, 
  Upload, 
  Trash2, 
  Brain, 
  LogOut, 
  LogIn, 
  Loader2, 
  CheckCircle2,
  RotateCcw,
  Menu,
  X,
  ChevronRight
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
  content: string;
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

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [documents, setDocuments] = useState<DocumentData[]>([]);
  const [analyses, setAnalyses] = useState<AnalysisData[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<DocumentData | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [activeAgent, setActiveAgent] = useState<AgentType>('classify_doc');
  const [customPrompt, setCustomPrompt] = useState('');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' ? window.innerWidth < 1024 : false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    console.log("File selection event triggered");
    if (!file) {
      console.log("No file selected");
      return;
    }
    if (!user) {
      console.log("No user logged in");
      setGlobalError("Debes estar ingresado para subir archivos.");
      return;
    }

    console.log(`Selected file: ${file.name}, size: ${file.size} bytes, type: ${file.type}`);
    setIsUploading(true);
    setGlobalError(null);
    try {
      const reader = new FileReader();
      
      // Check file size (Firestore limit is 1MB per document)
      // Base64 encoding adds ~33% overhead, so we limit to ~500KB for safety
      if (file.size > 500 * 1024) {
        console.log("File too large");
        setGlobalError("El archivo es demasiado grande. Por favor intenta con uno menor a 500KB.");
        setIsUploading(false);
        if (e.target) e.target.value = '';
        return;
      }

      reader.onload = async (event) => {
        console.log("FileReader loaded successfully");
        const base64 = event.target?.result as string;
        try {
          console.log(`Attempting to add document to Firestore for user: ${user.uid}`);
          const docRef = await addDoc(collection(db, 'documents'), {
            name: file.name,
            type: file.type,
            content: base64,
            userId: user.uid,
            createdAt: new Date().toISOString()
          });
          console.log("Document added successfully with ID:", docRef.id);
        } catch (error: any) {
          console.error("Firestore addDoc error details:", error);
          setGlobalError(`Error de Firestore: ${error.code || 'sin código'} - ${error.message || 'Error desconocido'}`);
          handleFirestoreError(error, OperationType.CREATE, 'documents');
        } finally {
          setIsUploading(false);
          if (e.target) e.target.value = '';
        }
      };
      reader.onerror = (error) => {
        console.error("FileReader error:", error);
        setIsUploading(false);
        if (e.target) e.target.value = '';
      };
      reader.readAsDataURL(file);
    } catch (error) {
      console.error("Upload error:", error);
      setIsUploading(false);
      if (e.target) e.target.value = '';
    }
  };

  const handleDeleteDoc = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
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
      const analysisResult = await analyzeDocument(
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
    } catch (error) {
      console.error("Analysis error:", error);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const currentAnalysis = analyses.find(a => a.documentId === selectedDoc?.id && a.agentType === activeAgent);

  if (!isAuthReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50">
        <Loader2 className="w-8 h-8 animate-spin text-zinc-400" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-zinc-50 p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full bg-white p-8 rounded-3xl shadow-sm border border-zinc-200 text-center"
        >
          <div className="w-16 h-16 bg-zinc-900 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <Brain className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-semibold text-zinc-900 mb-2">Agente AtlasOps</h1>
          <p className="text-zinc-500 mb-8">Sube tus documentos y deja que nuestros agentes inteligentes extraigan el valor por ti.</p>
          <button 
            onClick={handleLogin}
            className="w-full flex items-center justify-center gap-2 bg-zinc-900 text-white py-3 px-6 rounded-xl font-medium hover:bg-zinc-800 transition-colors"
          >
            <LogIn className="w-5 h-5" />
            Ingresar con Google
          </button>
        </motion.div>
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
      <div className="lg:hidden flex items-center justify-between p-4 bg-white border-b border-zinc-200 sticky top-0 z-50">
        <div className="flex items-center gap-2">
          <Brain className="w-6 h-6 text-zinc-900" />
          <span className="font-bold text-zinc-900 tracking-tight">AtlasOps</span>
        </div>
        <button 
          onClick={() => setIsSidebarOpen(!isSidebarOpen)}
          className="p-2 text-zinc-500 hover:bg-zinc-100 rounded-lg transition-colors"
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
            className={`fixed inset-y-0 left-0 z-40 w-80 border-r border-zinc-200 bg-white flex flex-col lg:relative lg:translate-x-0 ${isSidebarOpen ? 'shadow-2xl' : ''}`}
          >
            <div className="p-6 border-b border-zinc-100 hidden lg:flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-zinc-900 rounded-lg flex items-center justify-center">
                  <Brain className="w-5 h-5 text-white" />
                </div>
                <span className="font-bold text-zinc-900 tracking-tight">AtlasOps</span>
              </div>
              <button onClick={handleLogout} className="text-zinc-400 hover:text-zinc-600 transition-colors p-1.5 hover:bg-zinc-50 rounded-lg">
                <LogOut className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4">
              <button 
                onClick={() => {
                  fileInputRef.current?.click();
                  if (window.innerWidth < 1024) setIsSidebarOpen(false);
                }}
                disabled={isUploading}
                className="w-full flex items-center justify-center gap-2 bg-zinc-900 text-white py-3 px-4 rounded-xl font-semibold hover:bg-zinc-800 transition-all shadow-sm hover:shadow-md active:scale-[0.98] disabled:opacity-50"
              >
                {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                Subir Documento
              </button>
              <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleFileUpload} 
                className="hidden" 
                accept=".pdf,.txt,.doc,.docx,image/*"
              />
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-1 no-scrollbar">
              <div className="px-3 mb-2">
                <h3 className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Documentos Recientes</h3>
              </div>
              {documents.length === 0 ? (
                <div className="text-center py-12 px-4">
                  <div className="w-12 h-12 bg-zinc-50 rounded-full flex items-center justify-center mx-auto mb-3">
                    <FileText className="w-6 h-6 text-zinc-200" />
                  </div>
                  <p className="text-xs text-zinc-400 font-medium">No hay documentos aún</p>
                </div>
              ) : (
                documents.map((doc) => (
                  <button
                    key={doc.id}
                    onClick={() => {
                      setSelectedDoc(doc);
                      if (window.innerWidth < 1024) setIsSidebarOpen(false);
                    }}
                    className={`w-full text-left p-3 rounded-xl flex items-center gap-3 transition-all group relative ${
                      selectedDoc?.id === doc.id 
                        ? 'bg-zinc-100 text-zinc-900 ring-1 ring-zinc-200' 
                        : 'hover:bg-zinc-50 text-zinc-500'
                    }`}
                  >
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                      selectedDoc?.id === doc.id ? 'bg-white shadow-sm' : 'bg-zinc-50'
                    }`}>
                      <FileText className={`w-4 h-4 ${selectedDoc?.id === doc.id ? 'text-zinc-900' : 'text-zinc-400'}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{doc.name}</p>
                      <p className="text-[10px] text-zinc-400 truncate uppercase tracking-tighter">{doc.type.split('/')[1] || 'DOC'}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Trash2 
                        onClick={(e) => handleDeleteDoc(doc.id, e)}
                        className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity hover:text-red-500 text-zinc-400" 
                      />
                      <ChevronRight className={`w-4 h-4 transition-transform ${selectedDoc?.id === doc.id ? 'rotate-90 opacity-100' : 'opacity-0 group-hover:opacity-100'}`} />
                    </div>
                  </button>
                ))
              )}
            </div>

            <div className="p-4 border-t border-zinc-100 bg-zinc-50/50">
              <div className="mb-4 p-2 bg-zinc-100 rounded-lg text-[10px] font-mono text-zinc-500 break-all">
                <p>UID: {user.uid}</p>
                <p>Docs: {documents.length}</p>
                <p>Analyses: {analyses.length}</p>
                <p>DB: {db.app.options.projectId}</p>
                <button 
                  onClick={testConnection}
                  disabled={isTestingConnection}
                  className="mt-2 w-full py-1 px-2 bg-zinc-200 hover:bg-zinc-300 rounded text-[9px] font-bold transition-colors disabled:opacity-50"
                >
                  {isTestingConnection ? 'Probando...' : 'Probar Conexión'}
                </button>
              </div>
              <div className="flex items-center gap-3">
                <div className="relative">
                  <img src={user.photoURL || ''} alt={user.displayName || ''} className="w-10 h-10 rounded-xl bg-zinc-200 object-cover border-2 border-white shadow-sm" referrerPolicy="no-referrer" />
                  <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-emerald-500 border-2 border-white rounded-full"></div>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-zinc-900 truncate">{user.displayName}</p>
                  <p className="text-[10px] text-zinc-400 truncate font-medium">{user.email}</p>
                </div>
                <button onClick={handleLogout} className="lg:hidden text-zinc-400 hover:text-zinc-600">
                  <LogOut className="w-5 h-5" />
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
            <header className="bg-white/80 backdrop-blur-xl border-b border-zinc-200 p-4 lg:p-6 sticky top-0 z-30">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-zinc-900 rounded-2xl flex items-center justify-center shrink-0 shadow-lg shadow-zinc-200">
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
                    className="flex-1 lg:flex-none flex items-center justify-center gap-2 bg-zinc-100 text-zinc-600 py-2.5 px-5 rounded-xl font-bold text-sm hover:bg-zinc-200 transition-all active:scale-95"
                  >
                    <RotateCcw className="w-4 h-4" />
                    <span className="hidden sm:inline">Reiniciar</span>
                  </button>

                  {activeAgent === 'classify_doc' ? (
                    <button 
                      onClick={() => handleAnalyze('classify_doc')}
                      disabled={isAnalyzing}
                      className="flex-[2] lg:flex-none flex items-center justify-center gap-2 bg-zinc-900 text-white py-2.5 px-6 rounded-xl font-bold text-sm hover:bg-zinc-800 transition-all shadow-md hover:shadow-lg active:scale-95 disabled:opacity-50"
                    >
                      {isAnalyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                      1. Identificar
                    </button>
                  ) : (
                    <button 
                      onClick={() => handleAnalyze()}
                      disabled={isAnalyzing || !canExtract}
                      className="flex-[2] lg:flex-none flex items-center justify-center gap-2 bg-zinc-900 text-white py-2.5 px-6 rounded-xl font-bold text-sm hover:bg-zinc-800 transition-all shadow-md hover:shadow-lg active:scale-95 disabled:opacity-50"
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
                    className={`whitespace-nowrap px-5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all border ${
                      activeAgent === type 
                        ? 'bg-zinc-900 text-white border-zinc-900 shadow-md' 
                        : 'bg-white text-zinc-400 border-zinc-200 hover:border-zinc-300 hover:text-zinc-600'
                    } disabled:opacity-30 disabled:cursor-not-allowed`}
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
                    <div className="w-24 h-24 bg-white rounded-[2rem] shadow-sm border border-zinc-100 flex items-center justify-center mb-6">
                      <Brain className="w-10 h-10 text-zinc-100" />
                    </div>
                    <h3 className="text-lg font-bold text-zinc-900 mb-1">Listo para Analizar</h3>
                    <p className="text-sm font-medium text-zinc-400 text-center max-w-xs">Selecciona un agente en la parte superior y haz clic en el botón de acción para comenzar.</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-6 lg:p-12">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="max-w-2xl w-full text-center"
            >
              <div className="relative inline-block mb-10">
                <div className="absolute inset-0 bg-zinc-900/5 blur-3xl rounded-full"></div>
                <div className="relative w-24 h-24 bg-white rounded-[2.5rem] shadow-2xl flex items-center justify-center border border-zinc-100">
                  <Brain className="w-12 h-12 text-zinc-900" />
                </div>
              </div>
              
              <h1 className="text-2xl lg:text-4xl font-bold text-zinc-900 mb-4 tracking-tight leading-tight">
                AtlasOps la Plataforma de Gestión y <br className="hidden lg:block" /> Control de Documentos Laborales
              </h1>
              <p className="text-base lg:text-lg text-zinc-500 mb-12 max-w-lg mx-auto leading-relaxed">
                AtlasOps utiliza agentes de IA avanzados para clasificar, extraer y validar información crítica de tus documentos en segundos.
              </p>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-left">
                <div className="p-6 rounded-[2rem] bg-white border border-zinc-100 shadow-xl shadow-zinc-200/20 group hover:border-zinc-900 transition-all duration-500">
                  <div className="w-12 h-12 bg-zinc-50 rounded-2xl flex items-center justify-center mb-4 group-hover:bg-zinc-900 transition-colors">
                    <CheckCircle2 className="w-6 h-6 text-zinc-900 group-hover:text-white" />
                  </div>
                  <h3 className="text-sm font-bold text-zinc-900 mb-2 uppercase tracking-wider">Clasificación Automática</h3>
                  <p className="text-xs text-zinc-500 leading-relaxed">Identifica instantáneamente el tipo de documento y su relevancia para el cumplimiento laboral.</p>
                </div>
                <div className="p-6 rounded-[2rem] bg-white border border-zinc-100 shadow-xl shadow-zinc-200/20 group hover:border-zinc-900 transition-all duration-500">
                  <div className="w-12 h-12 bg-zinc-50 rounded-2xl flex items-center justify-center mb-4 group-hover:bg-zinc-900 transition-colors">
                    <Brain className="w-6 h-6 text-zinc-900 group-hover:text-white" />
                  </div>
                  <h3 className="text-sm font-bold text-zinc-900 mb-2 uppercase tracking-wider">Extracción de Datos</h3>
                  <p className="text-xs text-zinc-500 leading-relaxed">Extrae fechas, nombres, RUTs y montos automáticamente con alta precisión.</p>
                </div>
              </div>

              <div className="mt-12 pt-12 border-t border-zinc-100 flex flex-col items-center gap-4">
                <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-[0.2em]">Comienza ahora</p>
                <button 
                  onClick={() => setIsSidebarOpen(true)}
                  className="lg:hidden flex items-center gap-2 bg-zinc-900 text-white py-3 px-8 rounded-2xl font-bold text-sm shadow-xl shadow-zinc-900/20 active:scale-95"
                >
                  <Upload className="w-4 h-4" />
                  Subir primer documento
                </button>
                <div className="hidden lg:flex items-center gap-2 text-zinc-400">
                  <ChevronRight className="w-4 h-4 animate-bounce rotate-90" />
                  <span className="text-xs font-medium">Selecciona un documento en la barra lateral</span>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </main>
    </div>
  );
}
