<!DOCTYPE html>
<html lang="bs">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Liquid Glass Login</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet">
    <style>
        body {
            font-family: 'Inter', sans-serif;
            margin: 0;
            padding: 0;
            background-color: #0f172a; /* Tamna podloga za kontrast */
            overflow: hidden; /* Sprečava scroll zbog animiranih blobova */
        }

        /* --- ANIMIRANA POZADINA (LIQUID) --- */
        .ambient-light {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            overflow: hidden;
            z-index: 0;
        }

        .blob {
            position: absolute;
            filter: blur(80px);
            opacity: 0.8;
            animation: move 20s infinite alternate;
            border-radius: 50%;
        }

        .blob-1 {
            background: #4f46e5; /* Indigo */
            width: 500px;
            height: 500px;
            top: -100px;
            left: -100px;
            animation-duration: 25s;
        }

        .blob-2 {
            background: #ec4899; /* Pink */
            width: 400px;
            height: 400px;
            bottom: -50px;
            right: -50px;
            animation-duration: 30s;
            animation-direction: alternate-reverse;
        }

        .blob-3 {
            background: #06b6d4; /* Cyan */
            width: 300px;
            height: 300px;
            top: 40%;
            left: 40%;
            animation-duration: 22s;
        }

        @keyframes move {
            from { transform: translate(0, 0) scale(1); }
            to { transform: translate(50px, -50px) scale(1.1); }
        }

        /* --- GLAVNI GLASS EFEKAT --- */
        .glass-panel {
            /* Osnova stakla */
            background: rgba(255, 255, 255, 0.05);
            backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px);
            
            /* Ivice stakla (Highlight) */
            border-top: 1px solid rgba(255, 255, 255, 0.3);
            border-left: 1px solid rgba(255, 255, 255, 0.3);
            border-right: 1px solid rgba(255, 255, 255, 0.1);
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
            
            box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.37);
        }

        /* Dekorativni lebdeći komadi stakla */
        .shard {
            position: absolute;
            z-index: 1;
            border-radius: 24px;
            pointer-events: none; /* Da ne smetaju klikovima */
            animation: float 6s ease-in-out infinite;
        }

        .shard-1 {
            width: 100px;
            height: 100px;
            top: -40px;
            right: -40px;
            background: rgba(255, 255, 255, 0.1);
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.2);
            animation-delay: 0s;
        }

        .shard-2 {
            width: 80px;
            height: 80px;
            bottom: 40px;
            left: -40px;
            background: rgba(255, 255, 255, 0.08);
            backdrop-filter: blur(8px);
            border: 1px solid rgba(255, 255, 255, 0.15);
            animation-delay: 2s;
            border-radius: 20px;
        }

        .shard-3 {
            width: 60px;
            height: 60px;
            bottom: -30px;
            right: 20px;
            background: rgba(255, 255, 255, 0.05);
            backdrop-filter: blur(5px);
            border: 1px solid rgba(255, 255, 255, 0.1);
            animation-delay: 1s;
            border-radius: 16px;
        }

        @keyframes float {
            0% { transform: translateY(0px) rotate(0deg); }
            50% { transform: translateY(-15px) rotate(2deg); }
            100% { transform: translateY(0px) rotate(0deg); }
        }

        /* --- INPUT POLJA --- */
        .glass-input {
            background: rgba(0, 0, 0, 0.2);
            border: 1px solid rgba(255, 255, 255, 0.1);
            color: white;
            transition: all 0.3s ease;
        }
        
        .glass-input:focus {
            outline: none;
            background: rgba(0, 0, 0, 0.3);
            border-color: rgba(255, 255, 255, 0.5);
            box-shadow: 0 0 15px rgba(255, 255, 255, 0.1);
        }

        .glass-input::placeholder {
            color: rgba(255, 255, 255, 0.4);
        }

        /* --- DUGME --- */
        .glass-btn {
            background: rgba(255, 255, 255, 0.9);
            color: #0f172a;
            border: none;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .glass-btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 10px 20px rgba(0, 0, 0, 0.2);
            background: #ffffff;
        }
        
        .glass-btn:active {
            transform: translateY(0);
        }

    </style>
</head>
<body class="h-screen w-full flex items-center justify-center relative">

    <!-- Pozadinski tečni oblici (The Liquid) -->
    <div class="ambient-light">
        <div class="blob blob-1"></div>
        <div class="blob blob-2"></div>
        <div class="blob blob-3"></div>
    </div>

    <!-- Glavni Wrapper -->
    <div class="relative z-10 p-8">
        
        <!-- Glavna Login Forma (Glavna ploča stakla) -->
        <div class="glass-panel relative w-[380px] p-10 rounded-[32px] overflow-hidden flex flex-col justify-center items-center">
            
            <!-- Dekorativni sjaj unutar kartice -->
            <div class="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-white/20 to-transparent"></div>

            <!-- Header -->
            <div class="w-full mb-8 text-center">
                <!-- Ikona ili Logo placeholder -->
                <div class="w-16 h-16 bg-white/10 rounded-2xl mx-auto mb-4 flex items-center justify-center backdrop-blur-md border border-white/20 shadow-lg">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8 text-white/90" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                </div>
                <h1 class="text-3xl font-semibold text-white tracking-tight mb-1">Dobrodošli</h1>
                <p class="text-white/40 text-sm font-light">Prijavite se na svoj nalog</p>
            </div>

            <!-- Forma -->
            <form class="w-full space-y-5" onsubmit="event.preventDefault(); alert('Login simulacija uspješna!');">
                
                <!-- Email Input -->
                <div class="group">
                    <label class="block text-xs uppercase tracking-wider text-white/50 mb-1.5 font-medium ml-1">Email Adresa</label>
                    <div class="relative">
                        <input type="email" placeholder="ime@primjer.com" class="glass-input w-full px-5 py-3.5 rounded-xl text-sm backdrop-blur-sm">
                        <!-- Ikona desno -->
                        <div class="absolute right-4 top-3.5 text-white/30">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M16 12a4 4 0 10-8 0 4 4 0 008 0zm0 0v1.5a2.5 2.5 0 005 0V12a9 9 0 10-9 9m4.5-1.206a8.959 8.959 0 01-4.5 1.207" />
                            </svg>
                        </div>
                    </div>
                </div>

                <!-- Password Input -->
                <div class="group">
                    <div class="flex justify-between items-center mb-1.5 ml-1">
                        <label class="block text-xs uppercase tracking-wider text-white/50 font-medium">Lozinka</label>
                        <a href="#" class="text-xs text-white/60 hover:text-white transition-colors">Zaboravljena?</a>
                    </div>
                    <div class="relative">
                        <input type="password" placeholder="••••••••" class="glass-input w-full px-5 py-3.5 rounded-xl text-sm backdrop-blur-sm">
                         <div class="absolute right-4 top-3.5 text-white/30 cursor-pointer hover:text-white/50 transition">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                            </svg>
                        </div>
                    </div>
                </div>

                <!-- Submit Button -->
                <button type="submit" class="glass-btn w-full py-4 rounded-xl text-sm font-semibold tracking-wide shadow-lg mt-4">
                    Prijavi se
                </button>
            </form>

            <!-- Footer -->
            <div class="mt-8 text-center">
                <p class="text-white/40 text-xs">
                    Nemaš nalog? 
                    <a href="#" class="text-white font-medium hover:underline ml-1">Registruj se</a>
                </p>
            </div>
        </div>

        <!-- Lebdeći komadi stakla (The Shards) -->
        <!-- Ovi elementi daju taj "Microsoft Logo" slojeviti efekat -->
        <div class="shard shard-1"></div>
        <div class="shard shard-2"></div>
        <div class="shard shard-3"></div>

    </div>

</body>
</html>