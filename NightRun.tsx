Import { useCallback, useEffect, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from "react";
import * as THREE from "three";
import {
  ArrowLeft,
  Bell,
  Car,
  Check,
  Circle,
  Coins,
  Copy,
  Gauge,
  Magnet,
  Pause,
  Paintbrush,
  Play,
  RotateCcw,
  Share2,
  ShoppingCart,
  Sparkles,
  Square,
  Target,
  Triangle,
  Trophy,
  Users,
  Volume2,
  VolumeX,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { makeCar, setCarModel, type CarModel } from "@/lib/carModels";
import type { GamePlayerProfile, GamePlayerSummary, GarageItem, LeaderboardEntry } from "@shared/schema";
import "./NightRun.css";

type GamePhase = "ready" | "playing" | "paused" | "over";
type GameStats = { speed: number; distance: number; score: number; coins: number };
type InputState = { left: boolean; right: boolean; accelerate: boolean; brake: boolean };
type EnvironmentMode = "night" | "day" | "rain" | "fog" | "sunrise" | "sunset" | "heavy-rain" | "dense-fog";
type ObstacleKind = "car" | "barrier" | "truck";
type PowerupKind = "nitro" | "magnet";
type SceneObstacle = {
  mesh: THREE.Group;
  active: boolean;
  kind: ObstacleKind;
  lane: number;
  direction: "oncoming" | "same";
  speedFactor: number;
  drift: number;
  phase: number;
  counted: boolean;
};
type FallbackObstacle = {
  active: boolean;
  kind: ObstacleKind;
  lane: number;
  direction: "oncoming" | "same";
  speedFactor: number;
  drift: number;
  phase: number;
  counted: boolean;
  depth: number;
  color: string;
};
type Pickup = { lane: number; depth: number; active: boolean };
type ScenePowerup = { mesh: THREE.Group; active: boolean; kind: PowerupKind };
type FallbackPowerup = { lane: number; depth: number; active: boolean; kind: PowerupKind };
type PlayerLoginResponse = { player: GamePlayerProfile; players: GamePlayerSummary[] };
type ScoreSaveResponse = { leaderboard: LeaderboardEntry[]; player: GamePlayerProfile };
type GarageResponse = { player: GamePlayerProfile };
type ActivePanel = "garage" | "quests" | "friends" | null;
type MissionType = "delivery" | "overtake";
type MissionState = { type: MissionType; progress: number; completed: boolean };
type FriendData = {
  friends: Array<{ id: number; name: string; friendCode: string; highScore: number }>;
  incomingRequests: Array<{ id: number; playerId: number; name: string; friendCode: string }>;
  challenges: Array<{
    id: number;
    challengerId: number;
    challengerName: string;
    opponentId: number;
    opponentName: string;
    status: "pending" | "active" | "completed" | "declined" | "expired";
    targetDistance: number;
    challengerBest: number;
    opponentBest: number;
    rewardCoins: number;
    winnerId: number | null;
    expiresAt: string;
  }>;
};
type NotificationEntry = { id: number; type: string; message: string; createdAt: string };
type GhostResponse = { friendName: string | null; points: Array<{ x: number; distance: number }> };

const emptyInput = (): InputState => ({ left: false, right: false, accelerate: false, brake: false });
const environmentModes: EnvironmentMode[] = ["night", "day", "rain", "fog", "sunrise", "sunset", "heavy-rain", "dense-fog"];
const paintColors = {
  lime: { label: "ليموني", hex: "#d6e58b", three: 0xd6e58b },
  coral: { label: "مرجاني", hex: "#ff755f", three: 0xff755f },
  cyan: { label: "فيروزي", hex: "#72d6ce", three: 0x72d6ce },
  violet: { label: "بنفسجي", hex: "#b394f5", three: 0xb394f5 },
} as const;
const carStyles = {
  starter: { label: "القياسية", color: 0xd6e58b, fallback: "#d6e58b", maxSpeed: 46, grip: 7.6, price: 0 },
  sport: { label: "الرياضية", color: 0xff755f, fallback: "#ff755f", maxSpeed: 52, grip: 7.2, price: 450 },
  rally: { label: "الرالي", color: 0x72d6ce, fallback: "#72d6ce", maxSpeed: 48, grip: 8.6, price: 700 },
} as const;
const upgradePrices = {
  speed: (level: number) => 200 + level * 150,
  acceleration: (level: number) => 175 + level * 140,
  handling: (level: number) => 180 + level * 140,
};
const environmentLabels: Record<EnvironmentMode, string> = {
  night: "ليلي",
  day: "نهاري",
  rain: "مطر",
  fog: "ضباب",
  sunrise: "شروق",
  sunset: "غروب",
  "heavy-rain": "مطر غزير",
  "dense-fog": "ضباب كثيف",
};

function createStreetlamp() {
  const lamp = new THREE.Group();
  const post = new THREE.Mesh(
    new THREE.CylinderGeometry(0.055, 0.09, 5.7, 6),
    new THREE.MeshStandardMaterial({ color: 0x53635d, metalness: 0.7, roughness: 0.4 }),
  );
  post.position.y = 2.85;
  lamp.add(post);
  const arm = new THREE.Mesh(
    new THREE.BoxGeometry(1.3, 0.09, 0.09),
    new THREE.MeshStandardMaterial({ color: 0x53635d, metalness: 0.65 }),
  );
  arm.position.set(-0.54, 5.55, 0);
  lamp.add(arm);
  const shade = new THREE.Mesh(
    new THREE.BoxGeometry(0.45, 0.12, 0.34),
    new THREE.MeshStandardMaterial({ color: 0xe5ee91, emissive: 0xe1e88a, emissiveIntensity: 2 }),
  );
  shade.position.set(-1.08, 5.48, 0);
  lamp.add(shade);
  const glow = new THREE.PointLight(0xe7efa2, 12, 15, 2);
  glow.position.set(-1.08, 5.25, 0);
  lamp.add(glow);
  return lamp;
}

function makeBarrier() {
  const group = new THREE.Group();
  const concrete = new THREE.MeshStandardMaterial({ color: 0x858b84, roughness: 0.94 });
  const yellow = new THREE.MeshStandardMaterial({ color: 0xf0c657, roughness: 0.72, emissive: 0x5d4210, emissiveIntensity: 0.2 });
  const black = new THREE.MeshStandardMaterial({ color: 0x252a29, roughness: 0.86 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(2.35, 0.76, 0.86), concrete);
  base.position.y = 0.4;
  group.add(base);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.2, 0.035), yellow);
  stripe.position.set(0, 0.47, 0.45);
  group.add(stripe);
  for (let index = -2; index <= 2; index++) {
    const mark = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.22, 0.045), black);
    mark.position.set(index * 0.42, 0.47, 0.48);
    mark.rotation.z = -0.35;
    group.add(mark);
  }
  return group;
}

function makeTruck(color: number) {
  const group = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color, metalness: 0.35, roughness: 0.5 });
  const cargo = new THREE.Mesh(
    new THREE.BoxGeometry(1.72, 1.42, 1.72),
    new THREE.MeshStandardMaterial({ color: 0xaab1a3, metalness: 0.16, roughness: 0.75 }),
  );
  cargo.position.set(0, 1.1, 0.45);
  group.add(cargo);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.9, 0.92), paint);
  cab.position.set(0, 0.86, -0.88);
  group.add(cab);
  const windshield = new THREE.Mesh(
    new THREE.BoxGeometry(1.18, 0.4, 0.08),
    new THREE.MeshStandardMaterial({ color: 0x9ab8b6, metalness: 0.5, roughness: 0.24 }),
  );
  windshield.position.set(0, 1.08, -1.36);
  group.add(windshield);
  for (const side of [-1, 1]) {
    const wheel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.32, 0.32, 0.2, 12),
      new THREE.MeshStandardMaterial({ color: 0x101516, roughness: 0.9 }),
    );
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(side * 0.83, 0.34, -1.02);
    group.add(wheel);
    const rearWheel = wheel.clone();
    rearWheel.position.z = 0.93;
    group.add(rearWheel);
    const lamp = new THREE.Mesh(
      new THREE.BoxGeometry(0.31, 0.15, 0.06),
      new THREE.MeshStandardMaterial({ color: 0xffd986, emissive: 0xe8a33e, emissiveIntensity: 2.4 }),
    );
    lamp.position.set(side * 0.56, 0.62, -1.37);
    group.add(lamp);
  }
  return group;
}

function makePowerup(kind: PowerupKind) {
  const group = new THREE.Group();
  const color = kind === "nitro" ? 0xff725e : 0x70e1d8;
  const material = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 1.6,
    metalness: 0.5,
    roughness: 0.25,
  });
  const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.52, 0), material);
  group.add(core);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.7, 0.08, 8, 24),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.88 }),
  );
  ring.rotation.x = Math.PI / 2;
  group.add(ring);
  group.position.y = 0.9;
  return group;
}

function makePoliceCar() {
  const group = makeCar(0xe8e9df);
  group.scale.setScalar(0.88);
  const bar = new THREE.Mesh(
    new THREE.BoxGeometry(0.72, 0.13, 0.22),
    new THREE.MeshStandardMaterial({ color: 0x171c20, metalness: 0.45, roughness: 0.35 }),
  );
  bar.position.set(0, 1.27, 0.12);
  group.add(bar);
  const beacons: THREE.Mesh[] = [];
  for (const [x, color] of [[-0.23, 0x3e8bff], [0.23, 0xff3e57]] as const) {
    const beacon = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 0.16, 0.2),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 2.8 }),
    );
    beacon.position.set(x, 1.38, 0.12);
    beacon.userData.isPoliceBeacon = true;
    group.add(beacon);
    const light = new THREE.PointLight(color, 12, 9, 2);
    light.position.copy(beacon.position);
    group.add(light);
    beacons.push(beacon);
  }
  group.userData.beacons = beacons;
  return group;
}

function makeCoin() {
  const group = new THREE.Group();
  const gold = new THREE.MeshStandardMaterial({
    color: 0xffd45c,
    metalness: 0.86,
    roughness: 0.22,
    emissive: 0x6b4309,
    emissiveIntensity: 0.45,
  });
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.43, 0.12, 8, 20), gold);
  group.add(rim);
  const center = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.08, 16), gold);
  center.rotation.x = Math.PI / 2;
  group.add(center);
  group.position.y = 0.85;
  return group;
}

export default function NightRun() {
  const sceneHost = useRef<HTMLDivElement>(null);
  const phaseRef = useRef<GamePhase>("ready");
  const inputRef = useRef<InputState>(emptyInput());
  const keyboardInputRef = useRef<InputState>(emptyInput());
  const touchInputRef = useRef<InputState>(emptyInput());
  const playerRef = useRef<THREE.Group | null>(null);
  const obstacleRefs = useRef<SceneObstacle[]>([]);
  const coinRefs = useRef<Array<{ mesh: THREE.Group; active: boolean }>>([]);
  const powerupRefs = useRef<ScenePowerup[]>([]);
  const fallbackPlayerXRef = useRef(0);
  const fallbackObstaclesRef = useRef<FallbackObstacle[]>([]);
  const fallbackPickupsRef = useRef<Pickup[]>([]);
  const fallbackPowerupsRef = useRef<FallbackPowerup[]>([]);
  const currentPlayerRef = useRef<GamePlayerProfile | null>(null);
  const ghostPathRef = useRef<GhostResponse["points"]>([]);
  const ghostRecordRef = useRef<GhostResponse["points"]>([]);
  const ghostIndexRef = useRef(0);
  const ghostSampleClockRef = useRef(0);
  const ghostPositionRef = useRef<{ x: number; distance: number } | null>(null);
  const missionTypeRef = useRef<MissionType>("delivery");
  const missionElapsedRef = useRef(0);
  const missionOvertakesRef = useRef(0);
  const missionCompletedRef = useRef(false);
  const missionHandlerRef = useRef<(mission: MissionState) => void>(() => {});
  const policeSpeedClockRef = useRef(0);
  const policeTimeRef = useRef(0);
  const policeActiveRef = useRef(false);
  const policeCarRef = useRef<THREE.Group | null>(null);
  const policeHandlerRef = useRef<(active: boolean) => void>(() => {});
  const distanceRef = useRef(0);
  const speedRef = useRef(20);
  const scoreRef = useRef(0);
  const coinCountRef = useRef(0);
  const steeringRef = useRef(0);
  const lastFrameRef = useRef(0);
  const spawnTimerRef = useRef(0);
  const coinSpawnTimerRef = useRef(1.4);
  const powerupSpawnTimerRef = useRef(8);
  const nitroTimeRef = useRef(0);
  const magnetTimeRef = useRef(0);
  const lastSubmittedRunRef = useRef(false);
  const soundOnRef = useRef(false);
  const dangerRef = useRef(false);
  const environmentIndexRef = useRef(0);
  const environmentRef = useRef<EnvironmentMode>("night");
  const environmentHandlerRef = useRef<(mode: EnvironmentMode) => void>(() => {});
  const rafRef = useRef(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const engineOscillatorRef = useRef<OscillatorNode | null>(null);
  const engineGainRef = useRef<GainNode | null>(null);
  const phaseHandlerRef = useRef<(phase: GamePhase) => void>(() => {});
  const statsHandlerRef = useRef<(stats: GameStats) => void>(() => {});
  const powersHandlerRef = useRef<(powers: { nitro: number; magnet: number }) => void>(() => {});
  const dangerHandlerRef = useRef<(danger: boolean) => void>(() => {});
  const [phase, setPhase] = useState<GamePhase>("ready");
  const [stats, setStats] = useState<GameStats>({ speed: 0, distance: 0, score: 0, coins: 0 });
  const [sceneError, setSceneError] = useState(false);
  const [soundOn, setSoundOn] = useState(false);
  const [held, setHeld] = useState<string[]>([]);
  const [touchDevice, setTouchDevice] = useState(false);
  const [currentPlayer, setCurrentPlayer] = useState<GamePlayerProfile | null>(null);
  const [playerNameInput, setPlayerNameInput] = useState("");
  const [players, setPlayers] = useState<GamePlayerSummary[]>([]);
  const [playersLoading, setPlayersLoading] = useState(true);
  const [playersError, setPlayersError] = useState("");
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState(true);
  const [leaderboardError, setLeaderboardError] = useState("");
  const [scoreSaving, setScoreSaving] = useState(false);
  const [scoreSaveError, setScoreSaveError] = useState("");
  const [loginPending, setLoginPending] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [environment, setEnvironment] = useState<EnvironmentMode>("night");
  const [powerUps, setPowerUps] = useState({ nitro: 0, magnet: 0 });
  const [danger, setDanger] = useState(false);
  const [activePanel, setActivePanel] = useState<ActivePanel>(null);
  const [garagePending, setGaragePending] = useState<GarageItem | null>(null);
  const [garageMessage, setGarageMessage] = useState("");
  const [garageError, setGarageError] = useState("");
  const [shareMessage, setShareMessage] = useState("");
  const [mission, setMission] = useState<MissionState>({ type: "delivery", progress: 0, completed: false });
  const [policeChase, setPoliceChase] = useState(false);
  const [friendsData, setFriendsData] = useState<FriendData>({ friends: [], incomingRequests: [], challenges: [] });
  const [friendsLoading, setFriendsLoading] = useState(false);
  const [friendCodeInput, setFriendCodeInput] = useState("");
  const [friendMessage, setFriendMessage] = useState("");
  const [friendError, setFriendError] = useState("");
  const [friendActionPending, setFriendActionPending] = useState(false);
  const [activeNotification, setActiveNotification] = useState<NotificationEntry | null>(null);
  const [ghostName, setGhostName] = useState("");
  const panelPreviousPhaseRef = useRef<GamePhase>("ready");

  useEffect(() => {
    const coarsePointer = typeof window.matchMedia === "function"
      && window.matchMedia("(any-pointer: coarse)").matches;
    setTouchDevice(navigator.maxTouchPoints > 0 || coarsePointer || "ontouchstart" in window);
  }, []);

  currentPlayerRef.current = currentPlayer;
  soundOnRef.current = soundOn;
  missionHandlerRef.current = setMission;
  policeHandlerRef.current = setPoliceChase;

  useEffect(() => {
    if (!currentPlayer || !playerRef.current) return;
    const paint = paintColors[currentPlayer.paintColor].three;
    const tint = currentPlayer.windowTint === "dark" ? 0x41535c : 0x8aa4a0;
    const rim = currentPlayer.rimStyle === "sport" ? 0xff8b63 : currentPlayer.rimStyle === "rally" ? 0x72d6ce : 0xb9c8bb;
    setCarModel(playerRef.current, paint, currentPlayer.selectedCar);
    playerRef.current.scale.set(
      currentPlayer.selectedCar === "rally" ? 1.07 : currentPlayer.selectedCar === "sport" ? 1.025 : 1,
      currentPlayer.selectedCar === "rally" ? 0.92 : currentPlayer.selectedCar === "sport" ? 0.96 : 1,
      currentPlayer.selectedCar === "rally" ? 1.04 : currentPlayer.selectedCar === "sport" ? 1.02 : 1,
    );
    playerRef.current.traverse((part) => {
      if (!(part instanceof THREE.Mesh)) return;
      const materials = Array.isArray(part.material) ? part.material : [part.material];
      if (part.userData.isCarPaint) materials.forEach((material) => material.color.setHex(paint));
      if (part.userData.isCarGlass) {
        materials.forEach((material) => {
          material.color.setHex(tint);
          material.opacity = currentPlayer.windowTint === "dark" ? 0.48 : 0.78;
        });
      }
      if (part.userData.isWheelRim) materials.forEach((material) => material.color.setHex(rim));
    });
  }, [currentPlayer]);

  useEffect(() => {
    let active = true;
    let requestPending = false;

    const loadPlayers = async () => {
      if (requestPending) return;
      requestPending = true;
      try {
        const response = await fetch("/api/players", { credentials: "include" });
        if (!response.ok) throw new Error("Player list request failed");
        const roster = await response.json() as GamePlayerSummary[];
        if (active) {
          setPlayers(roster);
          setPlayersError("");
        }
      } catch {
        if (active) setPlayersError("تعذّر تحميل قائمة اللاعبين.");
      } finally {
        requestPending = false;
        if (active) setPlayersLoading(false);
      }
    };

    void loadPlayers();
    const interval = window.setInterval(() => void loadPlayers(), 8000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    let active = true;
    let requestPending = false;

    const loadLeaderboard = async () => {
      if (requestPending) return;
      requestPending = true;
      try {
        const response = await fetch("/api/leaderboard", { credentials: "include" });
        if (!response.ok) throw new Error("Leaderboard request failed");
        const entries = await response.json() as LeaderboardEntry[];
        if (active) {
          setLeaderboard(entries);
          setLeaderboardError("");
        }
      } catch {
        if (active) setLeaderboardError("تعذّر تحميل لوحة الصدارة.");
      } finally {
        requestPending = false;
        if (active) setLeaderboardLoading(false);
      }
    };

    void loadLeaderboard();
    const interval = window.setInterval(() => void loadLeaderboard(), 8000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!currentPlayer) {
      setFriendsData({ friends: [], incomingRequests: [], challenges: [] });
      ghostPathRef.current = [];
      setGhostName("");
      return;
    }
    let active = true;
    const playerId = currentPlayer.id;
    const loadFriends = async () => {
      try {
        const response = await fetch(`/api/friends/${playerId}`, { credentials: "include" });
        if (!response.ok) throw new Error();
        const data = await response.json() as FriendData;
        if (active) setFriendsData(data);
      } catch {
        if (active) setFriendError("تعذّر تحميل قائمة الأصدقاء.");
      } finally {
        if (active) setFriendsLoading(false);
      }
    };
    const loadGhost = async () => {
      try {
        const response = await fetch(`/api/friends/${playerId}/ghost`, { credentials: "include" });
        if (!response.ok) return;
        const ghost = await response.json() as GhostResponse;
        if (active) {
          ghostPathRef.current = ghost.points;
          setGhostName(ghost.friendName ?? "");
        }
      } catch {
        if (active) {
          ghostPathRef.current = [];
          setGhostName("");
        }
      }
    };
    const loadNotifications = async () => {
      try {
        const response = await fetch(`/api/notifications/${playerId}`, { credentials: "include" });
        if (!response.ok) return;
        const notifications = await response.json() as NotificationEntry[];
        if (!active || notifications.length === 0) return;
        setActiveNotification(notifications[0]);
        window.setTimeout(() => setActiveNotification((current) =>
          current?.id === notifications[0].id ? null : current,
        ), 7500);
        await apiRequest("POST", "/api/notifications/read", { playerId });
      } catch {
        // Keep the game playable when the notification service is temporarily unavailable.
      }
    };
    setFriendsLoading(true);
    void loadFriends();
    void loadGhost();
    void loadNotifications();
    const interval = window.setInterval(() => {
      void loadFriends();
      void loadNotifications();
    }, 12000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [currentPlayer?.id]);

  useEffect(() => {
    if (phase !== "over" || !currentPlayer || lastSubmittedRunRef.current) return;
    const finalScore = Math.max(0, Math.floor(scoreRef.current));
    let active = true;
    lastSubmittedRunRef.current = true;
    setScoreSaving(true);
    setScoreSaveError("");

    void apiRequest("POST", "/api/scores", {
      playerId: currentPlayer.id,
      score: finalScore,
      coinsCollected: coinCountRef.current,
      distance: Math.floor(distanceRef.current),
      missionType: missionTypeRef.current,
      missionCompleted: missionCompletedRef.current,
      ghostPath: ghostRecordRef.current.slice(0, 600),
    })
      .then((response) => response.json() as Promise<ScoreSaveResponse>)
      .then((result) => {
        if (active) {
          setLeaderboard(result.leaderboard);
          setCurrentPlayer(result.player);
          setLeaderboardError("");
        }
      })
      .catch(() => {
        if (active) setScoreSaveError("تعذّر حفظ نتيجتك. ستُعاد المحاولة عند إنهاء الجولة التالية.");
      })
      .finally(() => {
        if (active) setScoreSaving(false);
      });

    return () => {
      active = false;
    };
  }, [phase, currentPlayer?.id]);

  phaseHandlerRef.current = setPhase;
  statsHandlerRef.current = setStats;
  powersHandlerRef.current = setPowerUps;
  dangerHandlerRef.current = setDanger;
  phaseRef.current = phase;
  dangerRef.current = danger;

  const updatePhase = useCallback((next: GamePhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const syncInput = useCallback(() => {
    const keyboard = keyboardInputRef.current;
    const touch = touchInputRef.current;
    inputRef.current = {
      left: keyboard.left || touch.left,
      right: keyboard.right || touch.right,
      accelerate: keyboard.accelerate || touch.accelerate,
      brake: keyboard.brake || touch.brake,
    };
  }, []);

  const triggerPoliceChase = useCallback(() => {
    policeTimeRef.current = Math.max(policeTimeRef.current, 8);
    policeActiveRef.current = true;
    policeHandlerRef.current(true);
    const policeCar = policeCarRef.current;
    if (policeCar) {
      policeCar.visible = true;
      policeCar.position.set(playerRef.current?.position.x ?? fallbackPlayerXRef.current, 0, 7.8);
    }
  }, []);

  const startGame = useCallback(() => {
    const nextEnvironment = environmentModes[environmentIndexRef.current % environmentModes.length];
    environmentIndexRef.current += 1;
    environmentRef.current = nextEnvironment;
    setEnvironment(nextEnvironment);
    environmentHandlerRef.current(nextEnvironment);
    distanceRef.current = 0;
    speedRef.current = 20;
    scoreRef.current = 0;
    coinCountRef.current = 0;
    steeringRef.current = 0;
    fallbackPlayerXRef.current = 0;
    spawnTimerRef.current = 0.5;
    coinSpawnTimerRef.current = 1.15;
    powerupSpawnTimerRef.current = 7 + Math.random() * 5;
    nitroTimeRef.current = 0;
    magnetTimeRef.current = 0;
    missionTypeRef.current = Math.random() < 0.5 ? "delivery" : "overtake";
    missionElapsedRef.current = 0;
    missionOvertakesRef.current = 0;
    missionCompletedRef.current = false;
    missionHandlerRef.current({ type: missionTypeRef.current, progress: 0, completed: false });
    ghostRecordRef.current = [];
    ghostSampleClockRef.current = 0;
    ghostIndexRef.current = 0;
    ghostPositionRef.current = ghostPathRef.current[0] ?? null;
    policeSpeedClockRef.current = 0;
    policeTimeRef.current = 0;
    policeActiveRef.current = false;
    policeHandlerRef.current(false);
    if (policeCarRef.current) policeCarRef.current.visible = false;
    powersHandlerRef.current({ nitro: 0, magnet: 0 });
    dangerHandlerRef.current(false);
    lastSubmittedRunRef.current = false;
    setActivePanel(null);
    keyboardInputRef.current = emptyInput();
    touchInputRef.current = emptyInput();
    inputRef.current = emptyInput();
    setHeld([]);
    obstacleRefs.current.forEach((item) => {
      item.active = false;
      item.counted = false;
      const { mesh } = item;
      mesh.position.z = -100;
      mesh.visible = false;
    });
    fallbackObstaclesRef.current.forEach((item) => {
      item.depth = 140;
      item.active = false;
      item.counted = false;
    });
    powerupRefs.current.forEach((item) => {
      item.active = false;
      item.mesh.visible = false;
    });
    fallbackPowerupsRef.current.forEach((item) => {
      item.depth = 140;
      item.active = false;
    });
    coinRefs.current.forEach(({ mesh }) => {
      mesh.position.z = -120;
      mesh.visible = false;
    });
    fallbackPickupsRef.current.forEach((item) => {
      item.depth = 140;
      item.active = false;
    });
    if (playerRef.current) {
      playerRef.current.position.x = 0;
      const profile = currentPlayerRef.current;
      const paint = paintColors[profile?.paintColor ?? "lime"].three;
      const tint = profile?.windowTint === "dark" ? 0x41535c : 0x8aa4a0;
      const rim = profile?.rimStyle === "sport" ? 0xff8b63 : profile?.rimStyle === "rally" ? 0x72d6ce : 0xb9c8bb;
      playerRef.current.traverse((part) => {
        if (!(part instanceof THREE.Mesh)) return;
        const materials = Array.isArray(part.material) ? part.material : [part.material];
        if (part.userData.isCarPaint) materials.forEach((material) => material.color.setHex(paint));
        if (part.userData.isCarGlass) {
          materials.forEach((material) => {
            material.color.setHex(tint);
            material.opacity = profile?.windowTint === "dark" ? 0.48 : 0.78;
          });
        }
        if (part.userData.isWheelRim) materials.forEach((material) => material.color.setHex(rim));
      });
    }
    setPowerUps({ nitro: 0, magnet: 0 });
    setDanger(false);
    statsHandlerRef.current({ speed: 20, distance: 0, score: 0, coins: 0 });
    updatePhase("playing");
  }, [updatePhase]);

  const resetGame = useCallback(() => {
    if (!currentPlayer) return;
    startGame();
  }, [currentPlayer, startGame]);

  const handlePlayerLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = playerNameInput.trim().replace(/\s+/g, " ");
    if (!name) {
      setLoginError("اكتب اسمك للمتابعة.");
      return;
    }
    if (name.length > 32) {
      setLoginError("يجب ألا يتجاوز الاسم 32 حرفاً.");
      return;
    }

    setLoginPending(true);
    setLoginError("");
    try {
      const response = await apiRequest("POST", "/api/players", { name });
      const result = await response.json() as PlayerLoginResponse;
      setPlayers(result.players);
      setPlayersError("");
      setCurrentPlayer(result.player);
      currentPlayerRef.current = result.player;
      setPlayerNameInput(result.player.name);
      startGame();
    } catch {
      setLoginError("تعذّر حفظ الاسم. تحقق من الاتصال وحاول مجدداً.");
    } finally {
      setLoginPending(false);
    }
  };

  const toggleSound = () => {
    if (soundOnRef.current) {
      soundOnRef.current = false;
      engineGainRef.current?.gain.setTargetAtTime(0, audioContextRef.current?.currentTime ?? 0, 0.06);
      setSoundOn(false);
      return;
    }
    const AudioContextClass = window.AudioContext;
    if (!AudioContextClass) return;
    const audio = audioContextRef.current ?? new AudioContextClass();
    audioContextRef.current = audio;
    void audio.resume();
    if (!engineOscillatorRef.current) {
      const oscillator = audio.createOscillator();
      const filter = audio.createBiquadFilter();
      const gain = audio.createGain();
      oscillator.type = "sawtooth";
      oscillator.frequency.value = 82;
      filter.type = "lowpass";
      filter.frequency.value = 420;
      gain.gain.value = 0.025;
      oscillator.connect(filter);
      filter.connect(gain);
      gain.connect(audio.destination);
      oscillator.start();
      engineOscillatorRef.current = oscillator;
      engineGainRef.current = gain;
    }
    soundOnRef.current = true;
    setSoundOn(true);
  };

  const playSound = (kind: "coin" | "impact" | "power") => {
    const audio = audioContextRef.current;
    if (!soundOnRef.current || !audio || audio.state !== "running") return;
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    const now = audio.currentTime;
    if (kind === "coin") {
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(920, now);
      oscillator.frequency.exponentialRampToValueAtTime(1480, now + 0.09);
      gain.gain.setValueAtTime(0.07, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    } else if (kind === "power") {
      oscillator.type = "triangle";
      oscillator.frequency.setValueAtTime(440, now);
      oscillator.frequency.exponentialRampToValueAtTime(980, now + 0.16);
      gain.gain.setValueAtTime(0.055, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    } else {
      oscillator.type = "square";
      oscillator.frequency.setValueAtTime(135, now);
      oscillator.frequency.exponentialRampToValueAtTime(48, now + 0.18);
      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    }
    oscillator.connect(gain);
    gain.connect(audio.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.32);
  };

  const handleGarageAction = async (item: GarageItem) => {
    if (!currentPlayer || garagePending) return;
    setGaragePending(item);
    setGarageError("");
    setGarageMessage("");
    try {
      const response = await apiRequest("POST", "/api/garage/purchase", {
        playerId: currentPlayer.id,
        item,
      });
      if (!response.ok) {
        const error = await response.json() as { message?: string };
        throw new Error(error.message || "تعذّر تحديث المرآب.");
      }
      const result = await response.json() as GarageResponse;
      setCurrentPlayer(result.player);
      currentPlayerRef.current = result.player;
      setGarageMessage("تم تحديث مرآبك.");
    } catch (error) {
      setGarageError(error instanceof Error ? error.message : "تعذّر تحديث المرآب.");
    } finally {
      setGaragePending(null);
    }
  };

  const openPanel = (panel: Exclude<ActivePanel, null>) => {
    panelPreviousPhaseRef.current = phaseRef.current;
    if (phaseRef.current === "playing") updatePhase("paused");
    setActivePanel(panel);
  };

  const closePanel = () => {
    const previousPhase = panelPreviousPhaseRef.current;
    setActivePanel(null);
    if (previousPhase === "playing") updatePhase("playing");
  };

  const refreshFriendsData = async () => {
    if (!currentPlayer) return;
    const response = await fetch(`/api/friends/${currentPlayer.id}`, { credentials: "include" });
    if (!response.ok) throw new Error("تعذّر تحميل الأصدقاء.");
    setFriendsData(await response.json() as FriendData);
  };

  const handleAddFriend = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!currentPlayer || friendActionPending) return;
    setFriendActionPending(true);
    setFriendError("");
    setFriendMessage("");
    try {
      const response = await apiRequest("POST", "/api/friends/request", {
        playerId: currentPlayer.id,
        friendCode: friendCodeInput,
      });
      if (!response.ok) {
        const error = await response.json() as { message?: string };
        throw new Error(error.message || "تعذّر إرسال الطلب.");
      }
      setFriendsData(await response.json() as FriendData);
      setFriendCodeInput("");
      setFriendMessage("أُرسل طلب الصداقة. إذا كان لديه طلب معلّق، تم قبول الصداقة مباشرة.");
    } catch (error) {
      setFriendError(error instanceof Error ? error.message : "تعذّر إرسال الطلب.");
    } finally {
      setFriendActionPending(false);
    }
  };

  const respondToFriendRequest = async (requestId: number, accept: boolean) => {
    if (!currentPlayer || friendActionPending) return;
    setFriendActionPending(true);
    setFriendError("");
    try {
      const response = await apiRequest("POST", "/api/friends/respond", {
        playerId: currentPlayer.id,
        requestId,
        accept,
      });
      if (!response.ok) throw new Error("تعذّر تحديث طلب الصداقة.");
      setFriendsData(await response.json() as FriendData);
    } catch (error) {
      setFriendError(error instanceof Error ? error.message : "تعذّر تحديث طلب الصداقة.");
    } finally {
      setFriendActionPending(false);
    }
  };

  const createFriendChallenge = async (friendId: number) => {
    if (!currentPlayer || friendActionPending) return;
    setFriendActionPending(true);
    setFriendError("");
    setFriendMessage("");
    try {
      const response = await apiRequest("POST", "/api/challenges", {
        playerId: currentPlayer.id,
        friendId,
      });
      if (!response.ok) {
        const error = await response.json() as { message?: string };
        throw new Error(error.message || "تعذّر إنشاء التحدي.");
      }
      const challenges = await response.json() as FriendData["challenges"];
      setFriendsData((data) => ({ ...data, challenges }));
      setFriendMessage("أُرسل تحدي 100 متر بدون اصطدام، صالح لمدة 24 ساعة.");
    } catch (error) {
      setFriendError(error instanceof Error ? error.message : "تعذّر إنشاء التحدي.");
    } finally {
      setFriendActionPending(false);
    }
  };

  const respondToChallenge = async (challengeId: number, accept: boolean) => {
    if (!currentPlayer || friendActionPending) return;
    setFriendActionPending(true);
    setFriendError("");
    try {
      const response = await apiRequest("POST", "/api/challenges/respond", {
        playerId: currentPlayer.id,
        challengeId,
        accept,
      });
      if (!response.ok) throw new Error("تعذّر تحديث التحدي.");
      const challenges = await response.json() as FriendData["challenges"];
      setFriendsData((data) => ({ ...data, challenges }));
    } catch (error) {
      setFriendError(error instanceof Error ? error.message : "تعذّر تحديث التحدي.");
    } finally {
      setFriendActionPending(false);
    }
  };

  const copyFriendCode = async () => {
    if (!currentPlayer) return;
    try {
      await navigator.clipboard.writeText(currentPlayer.friendCode);
      setFriendMessage("نُسخ رمز الصداقة.");
    } catch {
      setFriendMessage(`رمزك: ${currentPlayer.friendCode}`);
    }
  };

  const shareHighScore = async () => {
    if (!currentPlayer || currentPlayer.highScore < 1) {
      setShareMessage("أنهِ جولة أولاً لتسجيل نتيجة قابلة للمشاركة.");
      return;
    }
    const text = `حققت ${formatScore(currentPlayer.highScore)} نقطة في لعبة خطّ الليل. هل تستطيع تجاوز نتيجتي؟`;
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: "خطّ الليل", text, url });
        setShareMessage("تم فتح قائمة المشاركة.");
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(`${text} ${url}`);
        setShareMessage("نُسخ تحدّي نتيجتك لتشاركه.");
      } else {
        window.open(`https://x.com/intent/post?text=${encodeURIComponent(`${text} ${url}`)}`, "_blank", "noopener,noreferrer");
        setShareMessage("فُتح رابط المشاركة.");
      }
    } catch {
      setShareMessage("تعذّرت المشاركة الآن.");
    }
  };

  const pauseGame = useCallback(() => {
    if (phaseRef.current === "playing") updatePhase("paused");
    else if (phaseRef.current === "paused") updatePhase("playing");
  }, [updatePhase]);

  useEffect(() => {
    const host = sceneHost.current;
    if (!host) return;
    let renderer: THREE.WebGLRenderer;
    try {
      const rendererCanvas = document.createElement("canvas");
      if (!rendererCanvas.getContext("webgl2")) throw new Error("WebGL 2 is unavailable");
      renderer = new THREE.WebGLRenderer({
        canvas: rendererCanvas,
        antialias: false,
        alpha: false,
        powerPreference: "low-power",
      });
    } catch {
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (!context) {
        setSceneError(true);
        return;
      }
      host.appendChild(canvas);
      setSceneError(false);

      const resizeFallback = () => {
        const width = Math.max(1, host.clientWidth);
        const height = Math.max(1, host.clientHeight);
        const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
      };
      const fallbackObserver = new ResizeObserver(resizeFallback);
      fallbackObserver.observe(host);
      resizeFallback();

      const fallbackColors = ["#b45b50", "#7f9d96", "#d6ae71", "#728594", "#a9a88b", "#846c73"];
      fallbackObstaclesRef.current = Array.from({ length: 7 }, (_, index) => ({
        lane: [-3.3, 0, 3.3][index % 3],
        depth: 140 + index * 16,
        active: false,
        color: fallbackColors[index % fallbackColors.length],
        kind: index % 5 === 0 ? "barrier" : index % 4 === 0 ? "truck" : "car",
        direction: index % 2 ? "same" : "oncoming",
        speedFactor: index % 2 ? 0.68 : 1.5,
        drift: index % 5 === 0 ? 0 : 0.28,
        phase: index * 0.9,
        counted: false,
      }));
      fallbackPickupsRef.current = Array.from({ length: 8 }, (_, index) => ({
        lane: [-3.3, 0, 3.3][index % 3],
        depth: 150 + index * 18,
        active: false,
      }));
      fallbackPowerupsRef.current = Array.from({ length: 4 }, (_, index) => ({
        lane: [-3.3, 0, 3.3][index % 3],
        depth: 190 + index * 28,
        active: false,
        kind: index % 2 ? "magnet" : "nitro",
      }));
      let fallbackLastFrame = 0;
      let fallbackStatsClock = 0;
      let fallbackElapsed = 0;
      let fallbackRaf = 0;

      const drawCar = (
        x: number,
        y: number,
        width: number,
        color: string,
        playerCar = false,
        headlights = false,
        model: CarModel = "sport",
      ) => {
        const height = width * (model === "rally" ? 1.06 : model === "starter" ? 0.99 : 1);
        context.save();
        context.translate(x, y);
        if (playerCar) {
          context.shadowColor = "rgba(229, 238, 145, .55)";
          context.shadowBlur = width * 0.35;
        }
        context.fillStyle = "rgba(0, 0, 0, .45)";
        context.beginPath();
        context.ellipse(0, height * 0.86, width * 0.56, height * 0.12, 0, 0, Math.PI * 2);
        context.fill();
        context.shadowBlur = 0;

        context.fillStyle = "#090e10";
        for (const wheelY of [height * 0.32, height * 0.72]) {
          for (const side of [-1, 1]) {
            context.beginPath();
            context.ellipse(side * width * 0.405, wheelY, width * 0.105, height * 0.105, 0, 0, Math.PI * 2);
            context.fill();
            context.fillStyle = "#7f8c87";
            context.beginPath();
            context.ellipse(side * width * 0.405, wheelY, width * 0.055, height * 0.065, 0, 0, Math.PI * 2);
            context.fill();
            context.fillStyle = "#090e10";
          }
        }

        const bodyGradient = context.createLinearGradient(-width * 0.4, 0, width * 0.42, height);
        bodyGradient.addColorStop(0, color);
        bodyGradient.addColorStop(0.48, color);
        bodyGradient.addColorStop(1, "#182022");
        context.fillStyle = "#0a1113";
        context.beginPath();
        context.moveTo(-width * 0.15, height * 0.015);
        context.lineTo(width * 0.15, height * 0.015);
        context.lineTo(width * 0.34, height * 0.13);
        context.lineTo(width * 0.46, height * 0.38);
        context.lineTo(width * 0.51, height * 0.77);
        context.quadraticCurveTo(width * 0.5, height * 0.89, width * 0.37, height * 0.92);
        context.lineTo(-width * 0.37, height * 0.92);
        context.quadraticCurveTo(-width * 0.5, height * 0.89, -width * 0.51, height * 0.77);
        context.lineTo(-width * 0.46, height * 0.38);
        context.lineTo(-width * 0.34, height * 0.13);
        context.closePath();
        context.fill();

        context.fillStyle = bodyGradient;
        context.beginPath();
        context.moveTo(-width * 0.15, height * 0.035);
        context.quadraticCurveTo(0, height * 0.005, width * 0.15, height * 0.035);
        context.lineTo(width * 0.32, height * 0.16);
        context.lineTo(width * 0.43, height * 0.41);
        context.lineTo(width * 0.47, height * 0.76);
        context.quadraticCurveTo(width * 0.45, height * 0.84, width * 0.34, height * 0.86);
        context.lineTo(-width * 0.34, height * 0.86);
        context.quadraticCurveTo(-width * 0.45, height * 0.84, -width * 0.47, height * 0.76);
        context.lineTo(-width * 0.43, height * 0.41);
        context.lineTo(-width * 0.32, height * 0.16);
        context.closePath();
        context.fill();

        context.fillStyle = "#101b20";
        context.beginPath();
        context.moveTo(-width * 0.26, height * 0.3);
        context.lineTo(-width * 0.21, height * 0.13);
        context.quadraticCurveTo(-width * 0.18, height * 0.09, -width * 0.12, height * 0.085);
        context.lineTo(width * 0.12, height * 0.085);
        context.quadraticCurveTo(width * 0.18, height * 0.09, width * 0.21, height * 0.13);
        context.lineTo(width * 0.26, height * 0.3);
        context.lineTo(width * 0.31, height * 0.49);
        context.lineTo(-width * 0.31, height * 0.49);
        context.closePath();
        context.fill();

        context.fillStyle = "rgba(104, 184, 197, .32)";
        context.beginPath();
        context.moveTo(-width * 0.18, height * 0.12);
        context.lineTo(width * 0.18, height * 0.12);
        context.lineTo(width * 0.23, height * 0.29);
        context.lineTo(-width * 0.23, height * 0.29);
        context.closePath();
        context.fill();
        context.fillStyle = "rgba(127, 200, 207, .19)";
        context.beginPath();
        context.moveTo(-width * 0.28, height * 0.33);
        context.lineTo(width * 0.28, height * 0.33);
        context.lineTo(width * 0.29, height * 0.46);
        context.lineTo(-width * 0.29, height * 0.46);
        context.closePath();
        context.fill();

        context.strokeStyle = "rgba(248, 255, 239, .48)";
        context.lineWidth = Math.max(1, width * 0.018);
        context.beginPath();
        context.moveTo(-width * 0.31, height * 0.21);
        context.lineTo(-width * 0.37, height * 0.58);
        context.moveTo(width * 0.31, height * 0.21);
        context.lineTo(width * 0.37, height * 0.58);
        context.stroke();

        context.fillStyle = "#161f21";
        context.fillRect(-width * 0.43, height * 0.78, width * 0.86, height * 0.1);
        context.fillStyle = "#06090a";
        context.fillRect(-width * 0.28, height * 0.8, width * 0.56, height * 0.11);

        const lampColor = headlights ? "#ffe29c" : "#ff4b58";
        context.fillStyle = lampColor;
        context.shadowColor = lampColor;
        context.shadowBlur = width * (headlights ? 0.26 : 0.16);
        if (headlights) {
          context.fillRect(-width * 0.35, height * 0.19, width * 0.16, height * 0.045);
          context.fillRect(width * 0.19, height * 0.19, width * 0.16, height * 0.045);
        } else {
          context.fillRect(-width * 0.37, height * 0.73, width * 0.16, height * 0.075);
          context.fillRect(width * 0.21, height * 0.73, width * 0.16, height * 0.075);
        }
        context.shadowBlur = 0;

        context.fillStyle = "#d9e0d5";
        context.fillRect(-width * 0.1, height * 0.81, width * 0.2, height * 0.045);

        if (model === "rally") {
          context.fillStyle = "#080d0e";
          context.fillRect(-width * 0.47, height * 0.865, width * 0.94, height * 0.035);
          context.fillStyle = color;
          context.fillRect(-width * 0.43, height * 0.89, width * 0.86, height * 0.055);
        } else if (model === "sport") {
          context.fillStyle = "#151d1f";
          context.fillRect(-width * 0.36, height * 0.9, width * 0.72, height * 0.035);
        }

        if (headlights) {
          context.fillStyle = "rgba(255, 225, 156, .18)";
          context.beginPath();
          context.moveTo(-width * 0.32, height * 0.18);
          context.lineTo(width * 0.32, height * 0.18);
          context.lineTo(width * 0.46, height * 0.37);
          context.lineTo(-width * 0.46, height * 0.37);
          context.closePath();
          context.fill();
        }
        context.restore();
      };

      const drawTruck = (x: number, y: number, width: number, color: string, headlights: boolean) => {
        const height = width * 1.35;
        drawCar(x, y + height * 0.16, width * 1.08, color, false, headlights);
        context.save();
        context.translate(x, y);
        context.fillStyle = "rgba(0,0,0,.42)";
        context.fillRect(-width * 0.48, height * 0.5, width * 0.96, height * 0.47);
        context.fillStyle = "#b6bdae";
        context.fillRect(-width * 0.44, height * 0.08, width * 0.88, height * 0.48);
        context.fillStyle = color;
        context.fillRect(-width * 0.44, height * 0.08, width * 0.88, height * 0.11);
        context.fillStyle = headlights ? "#ffe29c" : "#ff6957";
        context.shadowColor = context.fillStyle;
        context.shadowBlur = width * 0.22;
        context.fillRect(-width * 0.39, height * 0.65, width * 0.13, height * 0.08);
        context.fillRect(width * 0.26, height * 0.65, width * 0.13, height * 0.08);
        context.restore();
      };

      const drawBarrier = (x: number, y: number, width: number) => {
        const height = width * 0.52;
        context.save();
        context.translate(x, y);
        context.shadowColor = "rgba(0, 0, 0, .45)";
        context.shadowBlur = width * 0.15;
        context.fillStyle = "#5e6661";
        context.fillRect(-width * 0.5, height * 0.15, width, height * 0.7);
        context.shadowBlur = 0;
        context.fillStyle = "#c0c4b9";
        context.fillRect(-width * 0.47, height * 0.13, width * 0.94, height * 0.55);
        context.fillStyle = "#edc65c";
        context.fillRect(-width * 0.45, height * 0.31, width * 0.9, height * 0.2);
        context.save();
        context.beginPath();
        context.rect(-width * 0.45, height * 0.3, width * 0.9, height * 0.22);
        context.clip();
        context.fillStyle = "#272d2c";
        for (let stripe = -3; stripe <= 3; stripe++) {
          context.save();
          context.translate(stripe * width * 0.21, height * 0.4);
          context.rotate(-0.42);
          context.fillRect(-width * 0.035, -height * 0.3, width * 0.07, height * 0.7);
          context.restore();
        }
        context.restore();
        context.fillStyle = "#f4ead0";
        context.fillRect(-width * 0.47, height * 0.62, width * 0.94, height * 0.08);
        context.restore();
      };

      const drawCoin = (x: number, y: number, radius: number) => {
        context.save();
        context.translate(x, y);
        context.shadowColor = "rgba(255, 207, 76, .85)";
        context.shadowBlur = radius * 0.9;
        context.fillStyle = "#f5c84f";
        context.beginPath();
        context.ellipse(0, 0, radius * 0.78, radius, 0, 0, Math.PI * 2);
        context.fill();
        context.shadowBlur = 0;
        context.strokeStyle = "#fff0a2";
        context.lineWidth = Math.max(1, radius * 0.12);
        context.beginPath();
        context.ellipse(0, 0, radius * 0.55, radius * 0.78, 0, 0, Math.PI * 2);
        context.stroke();
        context.fillStyle = "rgba(255, 246, 191, .85)";
        context.fillRect(-radius * 0.08, -radius * 0.45, radius * 0.16, radius * 0.9);
        context.restore();
      };

      const drawPowerup = (x: number, y: number, size: number, kind: PowerupKind) => {
        const color = kind === "nitro" ? "#ff795f" : "#71e0d7";
        context.save();
        context.translate(x, y);
        context.shadowColor = color;
        context.shadowBlur = size * 0.8;
        context.fillStyle = color;
        context.beginPath();
        context.moveTo(0, -size);
        context.lineTo(size * 0.74, 0);
        context.lineTo(0, size);
        context.lineTo(-size * 0.74, 0);
        context.closePath();
        context.fill();
        context.shadowBlur = 0;
        context.strokeStyle = "#f6f5dc";
        context.lineWidth = Math.max(1, size * 0.12);
        context.beginPath();
        context.arc(0, 0, size * 0.44, 0, Math.PI * 2);
        context.stroke();
        context.restore();
      };

      const paintFallbackScene = (width: number, height: number) => {
        const horizon = height * 0.36;
        const center = width * 0.5;
        const roadTop = width * 0.075;
        const roadBottom = Math.min(width * 0.44, 570);
        const mode = environmentRef.current;
        const isNight = mode === "night" || mode === "sunset";
        const isRainy = mode === "rain" || mode === "heavy-rain";
        const isHeavyRain = mode === "heavy-rain";
        const isFoggy = mode === "fog" || mode === "dense-fog";
        const isDenseFog = mode === "dense-fog";
        const isSunrise = mode === "sunrise";
        const isSunset = mode === "sunset";
        const isDark = isNight || isRainy;
        const groundGradient = context.createLinearGradient(0, horizon, 0, height);
        groundGradient.addColorStop(0, mode === "day" ? "#657663" : isSunrise ? "#8e7661" : isSunset ? "#70535a" : isFoggy ? "#68736c" : "#1a2932");
        groundGradient.addColorStop(1, mode === "day" ? "#374d43" : isRainy ? "#101923" : isSunrise ? "#473b37" : isSunset ? "#282a37" : "#0b1420");
        context.fillStyle = groundGradient;
        context.fillRect(0, horizon, width, height - horizon);
        const skyGradient = context.createLinearGradient(0, 0, 0, horizon);
        skyGradient.addColorStop(0, mode === "day" ? "#78b3c7" : isSunrise ? "#d37d75" : isSunset ? "#4c526d" : isFoggy ? "#909d99" : isRainy ? "#111f31" : "#071326");
        skyGradient.addColorStop(0.72, mode === "day" ? "#91b4b0" : isSunrise ? "#edaa81" : isSunset ? "#986d73" : isFoggy ? "#b1b9ad" : isRainy ? "#293e55" : "#263d58");
        skyGradient.addColorStop(1, mode === "day" ? "#c4c1a0" : isSunrise ? "#f0c28a" : isSunset ? "#d17c68" : isFoggy ? "#b1b9ad" : isRainy ? "#536779" : "#6b7881");
        context.fillStyle = skyGradient;
        context.fillRect(0, 0, width, horizon + 2);

        if (isDark || isSunrise) {
          const glow = context.createRadialGradient(center, horizon * 0.95, 2, center, horizon * 0.95, width * 0.48);
          glow.addColorStop(0, isSunrise ? "rgba(255, 159, 112, .23)" : "rgba(109, 165, 202, .22)");
          glow.addColorStop(1, "rgba(109, 165, 202, 0)");
          context.fillStyle = glow;
          context.fillRect(0, 0, width, horizon * 1.4);
        }

        if (isDark) {
          for (let index = 0; index < 42; index++) {
            const starX = (index * 167 % 997) / 997 * width;
            const starY = (index * 43 % 100) / 100 * horizon * 0.76;
            context.fillStyle = `rgba(228, 239, 255, ${0.2 + (index % 4) * 0.1})`;
            context.fillRect(starX, starY, 1 + index % 2, 1 + index % 2);
          }
          if (!isRainy && mode === "night") {
            const moonX = width * 0.77;
            const moonY = horizon * 0.27;
            const moonRadius = Math.min(width, height) * 0.027;
            context.save();
            context.shadowColor = "rgba(223, 236, 255, .8)";
            context.shadowBlur = moonRadius * 1.8;
            context.fillStyle = "#dce8f4";
            context.beginPath();
            context.arc(moonX, moonY, moonRadius, 0, Math.PI * 2);
            context.fill();
            context.shadowBlur = 0;
            context.fillStyle = "#13243a";
            context.beginPath();
            context.arc(moonX + moonRadius * 0.42, moonY - moonRadius * 0.18, moonRadius * 0.88, 0, Math.PI * 2);
            context.fill();
            context.restore();
          }
        } else if (mode === "day") {
          context.save();
          context.shadowColor = "rgba(255, 238, 174, .7)";
          context.shadowBlur = 28;
          context.fillStyle = "#f4dfa0";
          context.beginPath();
          context.arc(width * 0.77, horizon * 0.35, Math.min(width, height) * 0.045, 0, Math.PI * 2);
          context.fill();
          context.restore();
        }

        for (let index = 0; index < 38; index++) {
          const buildingWidth = width * (0.012 + (index * 29 % 15) / 1000);
          const centerRatio = (index + 0.5) / 38;
          const centerBoost = 1 - Math.min(1, Math.abs(centerRatio - 0.5) * 1.65);
          const buildingHeight = horizon * (0.12 + (index * 17 % 18) / 100 + centerBoost * 0.2);
          const buildingX = centerRatio * width - buildingWidth / 2;
          const top = horizon - buildingHeight;
          const buildingGradient = context.createLinearGradient(buildingX, top, buildingX + buildingWidth, horizon);
          buildingGradient.addColorStop(0, mode === "day" ? "#53676b" : isFoggy ? "#64716f" : index % 3 === 0 ? "#17283a" : "#101f31");
          buildingGradient.addColorStop(1, mode === "day" ? "#344a4c" : isSunrise || isSunset ? "#38323e" : isFoggy ? "#515f60" : "#1c3044");
          context.fillStyle = buildingGradient;
          context.fillRect(buildingX, top, buildingWidth, buildingHeight);
          if (centerBoost > 0.42 && buildingHeight > horizon * 0.28 && index % 4 === 1) {
            context.fillRect(buildingX + buildingWidth * 0.43, top - horizon * 0.055, buildingWidth * 0.14, horizon * 0.06);
            context.fillRect(buildingX + buildingWidth * 0.48, top - horizon * 0.09, buildingWidth * 0.04, horizon * 0.045);
          }
          if (isDark || isSunset || isSunrise) {
            const columns = Math.max(2, Math.floor(buildingWidth / Math.max(4, width * 0.005)));
            const rows = Math.max(2, Math.floor(buildingHeight / Math.max(4, horizon * 0.06)));
            for (let row = 0; row < rows; row++) {
              for (let column = 0; column < columns; column++) {
                if ((index * 7 + row * 3 + column * 5) % 5 < 2) continue;
                const windowSize = Math.max(1, Math.min(width * 0.003, buildingWidth / (columns * 2.6)));
                context.fillStyle = (index + row + column) % 4 === 0 ? "rgba(255, 208, 132, .82)" : "rgba(151, 203, 229, .58)";
                context.fillRect(
                  buildingX + buildingWidth * 0.15 + column * (buildingWidth * 0.7 / columns),
                  top + horizon * 0.045 + row * (horizon * 0.055),
                  windowSize,
                  Math.max(1, horizon * 0.018),
                );
              }
            }
          }
        }

        context.fillStyle = mode === "day" ? "#b2a382" : isSunrise || isSunset ? "#bf7b64" : "#b86a55";
        context.beginPath();
        context.moveTo(center - roadTop - 10, horizon);
        context.lineTo(center + roadTop + 10, horizon);
        context.lineTo(center + roadBottom + 18, height);
        context.lineTo(center - roadBottom - 18, height);
        context.closePath();
        context.fill();

        const roadGradient = context.createLinearGradient(0, horizon, 0, height);
        roadGradient.addColorStop(0, mode === "day" ? "#555b55" : isRainy ? "#29383d" : "#343c39");
        roadGradient.addColorStop(1, mode === "day" ? "#353e3a" : isRainy ? "#172327" : "#202726");
        context.fillStyle = roadGradient;
        context.beginPath();
        context.moveTo(center - roadTop, horizon);
        context.lineTo(center + roadTop, horizon);
        context.lineTo(center + roadBottom, height);
        context.lineTo(center - roadBottom, height);
        context.closePath();
        context.fill();

        const roadPhase = (distanceRef.current * 0.012) % 1;
        for (let index = 0; index < 18; index++) {
          const depth = (index / 18 + roadPhase) % 1;
          const y = horizon + depth * (height - horizon);
          const half = roadTop + depth * (roadBottom - roadTop);
          const dashHeight = 1 + depth * 20;
          const dashWidth = 1 + depth * 5;
          context.fillStyle = `rgba(229, 238, 205, ${0.5 + depth * 0.35})`;
          for (const laneSide of [-1, 1]) {
            context.fillRect(center + laneSide * half / 3 - dashWidth / 2, y, dashWidth, dashHeight);
          }
        }

        for (let index = 0; index < 22; index++) {
          const depth = (index / 22 + (distanceRef.current * 0.006) % 1) % 1;
          const y = horizon + depth * (height - horizon);
          const half = roadTop + depth * (roadBottom - roadTop);
          const curbWidth = 1 + depth * 16;
          context.fillStyle = index % 2 ? "#e3d7b5" : mode === "day" ? "#a59b7d" : "#c96450";
          context.fillRect(center - half - curbWidth, y, curbWidth, 2 + depth * 9);
          context.fillRect(center + half, y, curbWidth, 2 + depth * 9);
        }

        for (const obstacle of fallbackObstaclesRef.current) {
          if (!obstacle.active) continue;
          const depth = 1 - Math.max(0, obstacle.depth) / 105;
          if (depth <= 0) continue;
          const half = roadTop + depth * (roadBottom - roadTop);
          const carWidth = (roadBottom * 0.38) * (0.15 + depth * 0.85);
          const x = center + (obstacle.lane + Math.sin(fallbackElapsed * 1.2 + obstacle.phase) * obstacle.drift) / 5.25 * half;
          const y = horizon + Math.pow(depth, 1.42) * (height - horizon) - carWidth * 1.18;
          if (obstacle.kind === "barrier") drawBarrier(x, y, carWidth * 1.05);
          else if (obstacle.kind === "truck") drawTruck(x, y, carWidth, obstacle.color, obstacle.direction === "oncoming" && isNight);
          else drawCar(x, y, carWidth, obstacle.color, false, obstacle.direction === "oncoming" && isNight);
          const laneGap = Math.abs(obstacle.lane - fallbackPlayerXRef.current);
          if (obstacle.depth < 18 && obstacle.depth > 3 && laneGap < 3.3) {
            context.save();
            context.strokeStyle = "rgba(255,204,112,.9)";
            context.shadowColor = "#ff8b55";
            context.shadowBlur = 8;
            context.lineWidth = Math.max(1, carWidth * 0.025);
            for (let spark = 0; spark < 4; spark++) {
              const offset = Math.sin(fallbackElapsed * 18 + spark * 4.3) * carWidth * 0.15;
              context.beginPath();
              context.moveTo(x + offset, y + carWidth * (0.25 + spark * 0.06));
              context.lineTo(x + offset + (spark % 2 ? 1 : -1) * carWidth * 0.14, y + carWidth * (0.1 + spark * 0.04));
              context.stroke();
            }
            context.restore();
          }
        }

        for (const pickup of fallbackPickupsRef.current) {
          if (!pickup.active) continue;
          const depth = 1 - Math.max(0, pickup.depth) / 105;
          if (depth <= 0) continue;
          const half = roadTop + depth * (roadBottom - roadTop);
          const size = Math.max(4, roadBottom * 0.38 * (0.15 + depth * 0.85) * 0.22);
          drawCoin(center + pickup.lane / 5.25 * half, horizon + Math.pow(depth, 1.42) * (height - horizon) - size, size);
        }
        for (const pickup of fallbackPowerupsRef.current) {
          if (!pickup.active) continue;
          const depth = 1 - Math.max(0, pickup.depth) / 105;
          if (depth <= 0) continue;
          const half = roadTop + depth * (roadBottom - roadTop);
          const size = Math.max(6, roadBottom * 0.38 * (0.15 + depth * 0.85) * 0.24);
          drawPowerup(
            center + pickup.lane / 5.25 * half,
            horizon + Math.pow(depth, 1.42) * (height - horizon) - size,
            size,
            pickup.kind,
          );
        }

        const playerWidth = roadBottom * 0.38;
        const playerStyle = paintColors[currentPlayerRef.current?.paintColor ?? "lime"];
        const playerX = center + fallbackPlayerXRef.current / 5.25 * roadBottom;
        const ghost = ghostPositionRef.current;
        if (ghost && ghostName) {
          const ghostDepth = THREE.MathUtils.clamp(
            0.52 + (ghost.distance - distanceRef.current) / 1400,
            0.2,
            0.82,
          );
          const ghostHalf = roadTop + ghostDepth * (roadBottom - roadTop);
          const ghostWidth = playerWidth * (0.16 + ghostDepth * 0.84);
          const ghostX = center + ghost.x / 5.25 * ghostHalf;
          const ghostY = horizon + Math.pow(ghostDepth, 1.42) * (height - horizon) - ghostWidth * 1.18;
          context.save();
          context.globalAlpha = 0.34;
          drawCar(ghostX, ghostY, ghostWidth, "#79dce0", true);
          context.restore();
        }
        if (isNight || isRainy) {
          const beam = context.createRadialGradient(playerX, height * 0.84, 2, playerX, height * 0.58, roadBottom * 1.15);
          beam.addColorStop(0, "rgba(236, 242, 195, .14)");
          beam.addColorStop(1, "rgba(236, 242, 195, 0)");
          context.fillStyle = beam;
          context.fillRect(playerX - roadBottom, height * 0.42, roadBottom * 2, height * 0.58);
        }
        drawCar(
          playerX,
          height * 0.75,
          playerWidth,
          playerStyle.hex,
          true,
          false,
          currentPlayerRef.current?.selectedCar ?? "starter",
        );
        if (policeActiveRef.current) {
          const policeX = center + fallbackPlayerXRef.current / 5.25 * roadBottom;
          const policeY = height * 0.94;
          drawCar(policeX, policeY, playerWidth * 0.78, "#e9e8df", false, false);
          context.save();
          const sirenColor = Math.floor(fallbackElapsed * 8) % 2 ? "#ff4056" : "#438fff";
          context.fillStyle = sirenColor;
          context.shadowColor = sirenColor;
          context.shadowBlur = 13;
          context.fillRect(policeX - playerWidth * 0.13, policeY - playerWidth * 0.12, playerWidth * 0.12, playerWidth * 0.07);
          context.fillRect(policeX + playerWidth * 0.02, policeY - playerWidth * 0.12, playerWidth * 0.12, playerWidth * 0.07);
          context.restore();
        }
        if (nitroTimeRef.current > 0) {
          context.save();
          context.strokeStyle = "rgba(255,125,79,.86)";
          context.shadowColor = "#ff765a";
          context.shadowBlur = 12;
          context.lineWidth = Math.max(2, playerWidth * 0.035);
          for (const side of [-1, 1]) {
            context.beginPath();
            context.moveTo(playerX + side * playerWidth * 0.23, height * 0.9);
            context.lineTo(playerX + side * playerWidth * 0.3, height * 0.98 + Math.sin(fallbackElapsed * 19 + side) * 8);
            context.stroke();
          }
          context.restore();
        }
        if (magnetTimeRef.current > 0) {
          context.save();
          context.strokeStyle = "rgba(113,224,215,.65)";
          context.lineWidth = 2;
          context.beginPath();
          context.ellipse(playerX, height * 0.86, playerWidth * 0.67, playerWidth * 0.21, 0, 0, Math.PI * 2);
          context.stroke();
          context.restore();
        }

        if (isRainy) {
          context.save();
          context.strokeStyle = "rgba(210, 229, 230, .42)";
          context.lineWidth = 1.2;
          context.strokeStyle = isHeavyRain ? "rgba(210, 229, 230, .56)" : "rgba(210, 229, 230, .42)";
          for (let index = 0; index < (isHeavyRain ? 150 : 75); index++) {
            const rainX = (index * 137 + fallbackElapsed * (isHeavyRain ? 260 : 180)) % (width + 24) - 12;
            const rainY = (index * 71 + fallbackElapsed * (isHeavyRain ? 590 : 420)) % (height + 20) - 10;
            context.beginPath();
            context.moveTo(rainX, rainY);
            context.lineTo(rainX - 5, rainY + 15);
            context.stroke();
          }
          context.restore();
        }
        if (isFoggy || isRainy) {
          const fog = context.createLinearGradient(0, horizon * 0.45, 0, height);
          fog.addColorStop(0, isFoggy ? `rgba(210, 218, 208, ${isDenseFog ? ".58" : ".38"})` : "rgba(145, 165, 171, .12)");
          fog.addColorStop(0.55, isFoggy ? `rgba(210, 218, 208, ${isDenseFog ? ".3" : ".13"})` : "rgba(145, 165, 171, .03)");
          fog.addColorStop(1, "rgba(210, 218, 208, 0)");
          context.fillStyle = fog;
          context.fillRect(0, horizon * 0.45, width, height * 0.55);
        }

        const vignette = context.createRadialGradient(center, height * 0.55, width * 0.14, center, height * 0.55, width * 0.74);
        vignette.addColorStop(0, "rgba(8, 15, 16, 0)");
        vignette.addColorStop(1, "rgba(8, 15, 16, .5)");
        context.fillStyle = vignette;
        context.fillRect(0, 0, width, height);
      };

      const animateFallback = (now: number) => {
        fallbackRaf = requestAnimationFrame(animateFallback);
        const delta = Math.min((now - (fallbackLastFrame || now)) / 1000, 0.04);
        fallbackLastFrame = now;
        if (phaseRef.current === "playing") {
          fallbackElapsed += delta;
          missionElapsedRef.current += delta;
          nitroTimeRef.current = Math.max(0, nitroTimeRef.current - delta);
          magnetTimeRef.current = Math.max(0, magnetTimeRef.current - delta);
          policeTimeRef.current = Math.max(0, policeTimeRef.current - delta);
          const input = inputRef.current;
          const profile = currentPlayerRef.current;
          const selectedStyle = carStyles[profile?.selectedCar ?? "starter"];
          const speedLimit = selectedStyle.maxSpeed + (profile?.speedUpgrade ?? 0) * 3.2 + (nitroTimeRef.current > 0 ? 22 : 0);
          const acceleration = 15 + (profile?.accelerationUpgrade ?? 0) * 4;
          if (input.accelerate) speedRef.current = Math.min(speedLimit, speedRef.current + delta * acceleration);
          else speedRef.current = Math.max(18, speedRef.current - delta * 2.3);
          if (input.brake) speedRef.current = Math.max(8, speedRef.current - delta * 26);
          const direction = Number(input.right) - Number(input.left);
          const grip = selectedStyle.grip + (profile?.handlingUpgrade ?? 0) * 0.9
            - (environmentRef.current === "rain" || environmentRef.current === "heavy-rain" ? 1.25 : 0);
          steeringRef.current += (direction * grip - steeringRef.current) * Math.min(1, delta * 8);
          fallbackPlayerXRef.current = THREE.MathUtils.clamp(
            fallbackPlayerXRef.current + steeringRef.current * delta,
            -3.95,
            3.95,
          );
          const travel = speedRef.current * delta * 0.92;
          distanceRef.current += travel;
          scoreRef.current += travel * 0.9;
          spawnTimerRef.current -= delta;
          if (spawnTimerRef.current <= 0) {
            const available = fallbackObstaclesRef.current.filter((item) => !item.active || item.depth < 0);
            const slot = available[Math.floor(Math.random() * available.length)];
            if (slot) {
              const choice = Math.random();
              slot.active = true;
              slot.lane = [-3.3, 0, 3.3][Math.floor(Math.random() * 3)];
              slot.depth = 83 + Math.random() * 20;
              slot.kind = choice < 0.19 ? "barrier" : choice < 0.42 ? "truck" : "car";
              slot.direction = Math.random() < 0.5 ? "oncoming" : "same";
              slot.speedFactor = slot.kind === "barrier" ? 1 : slot.direction === "oncoming" ? 1.5 : 0.68;
              slot.drift = slot.kind === "barrier" ? 0 : 0.2 + Math.random() * 0.18;
              slot.phase = Math.random() * Math.PI * 2;
              slot.counted = false;
            }
            spawnTimerRef.current = Math.max(0.72, 1.42 - distanceRef.current / 2600) + Math.random() * 0.46;
          }
          coinSpawnTimerRef.current -= delta;
          if (coinSpawnTimerRef.current <= 0) {
            const available = fallbackPickupsRef.current.filter((item) => !item.active || item.depth < 0);
            const pickup = available[Math.floor(Math.random() * available.length)];
            if (pickup) {
              pickup.active = true;
              pickup.lane = [-3.3, 0, 3.3][Math.floor(Math.random() * 3)];
              pickup.depth = 78 + Math.random() * 24;
            }
            coinSpawnTimerRef.current = 1.55 + Math.random() * 1.25;
          }
          powerupSpawnTimerRef.current -= delta;
          if (powerupSpawnTimerRef.current <= 0) {
            const available = fallbackPowerupsRef.current.filter((item) => !item.active || item.depth < 0);
            const pickup = available[Math.floor(Math.random() * available.length)];
            if (pickup) {
              pickup.active = true;
              pickup.kind = Math.random() < 0.5 ? "nitro" : "magnet";
              pickup.lane = [-3.3, 0, 3.3][Math.floor(Math.random() * 3)];
              pickup.depth = 82 + Math.random() * 24;
            }
            powerupSpawnTimerRef.current = 11 + Math.random() * 7;
          }
          for (const pickup of fallbackPickupsRef.current) {
            if (!pickup.active) continue;
            pickup.depth -= travel * (0.88 + Math.min(0.2, distanceRef.current / 5000));
            if (pickup.depth < -8) {
              pickup.active = false;
              continue;
            }
            if (magnetTimeRef.current > 0 && pickup.depth < 34 && pickup.depth > 3) {
              pickup.lane += (fallbackPlayerXRef.current - pickup.lane) * Math.min(1, delta * 2.4);
            }
            if (pickup.depth < 3.4 && pickup.depth > -3 && Math.abs(pickup.lane - fallbackPlayerXRef.current) < 1.45) {
              pickup.active = false;
              coinCountRef.current += 1;
              scoreRef.current += 60;
              playSound("coin");
            }
          }
          for (const pickup of fallbackPowerupsRef.current) {
            if (!pickup.active) continue;
            pickup.depth -= travel * (0.88 + Math.min(0.2, distanceRef.current / 5000));
            if (pickup.depth < -8) {
              pickup.active = false;
              continue;
            }
            if (pickup.depth < 3.5 && pickup.depth > -3 && Math.abs(pickup.lane - fallbackPlayerXRef.current) < 1.65) {
              pickup.active = false;
              if (pickup.kind === "nitro") nitroTimeRef.current = 6;
              else magnetTimeRef.current = 8;
              playSound("power");
            }
          }
          let nearbyDanger = false;
          for (const obstacle of fallbackObstaclesRef.current) {
            if (!obstacle.active) continue;
            obstacle.depth -= travel * obstacle.speedFactor * (0.88 + Math.min(0.2, distanceRef.current / 5000));
            if (!obstacle.counted && obstacle.depth <= 0 && obstacle.kind !== "barrier") {
              obstacle.counted = true;
              missionOvertakesRef.current += 1;
            }
            if (obstacle.depth < -8) {
              obstacle.active = false;
              continue;
            }
            const obstacleX = obstacle.lane + Math.sin(fallbackElapsed * 1.2 + obstacle.phase) * obstacle.drift;
            const collisionWidth = obstacle.kind === "barrier" ? 1.78 : obstacle.kind === "truck" ? 1.62 : 1.35;
            const laneDistance = Math.abs(obstacleX - fallbackPlayerXRef.current);
            if (obstacle.depth < 20 && obstacle.depth > 2 && laneDistance < collisionWidth + 1.25) nearbyDanger = true;
            if (obstacle.depth < 3.6 && obstacle.depth > -3 && laneDistance < collisionWidth) {
              if (nitroTimeRef.current > 0) {
                obstacle.active = false;
                triggerPoliceChase();
                playSound("impact");
                continue;
              }
              triggerPoliceChase();
              playSound("impact");
              statsHandlerRef.current({
                speed: Math.round(speedRef.current * 3.6),
                distance: Math.floor(distanceRef.current),
                score: Math.floor(scoreRef.current),
                coins: coinCountRef.current,
              });
              phaseHandlerRef.current("over");
              phaseRef.current = "over";
              inputRef.current = emptyInput();
              break;
            }
          }
          if (speedRef.current * 3.6 > 120) policeSpeedClockRef.current += delta;
          else policeSpeedClockRef.current = Math.max(0, policeSpeedClockRef.current - delta * 1.5);
          if (policeSpeedClockRef.current > 1.2 && policeTimeRef.current <= 0) policeTimeRef.current = 8;
          if (policeTimeRef.current > 0 && !policeActiveRef.current) {
            policeActiveRef.current = true;
            policeHandlerRef.current(true);
          } else if (policeTimeRef.current <= 0 && policeActiveRef.current) {
            policeActiveRef.current = false;
            policeHandlerRef.current(false);
          }
          if (!missionCompletedRef.current) {
            missionCompletedRef.current = missionTypeRef.current === "delivery"
              ? missionElapsedRef.current >= 90
              : missionOvertakesRef.current >= 20;
          }
          ghostSampleClockRef.current += delta;
          if (ghostSampleClockRef.current >= 0.25 && ghostRecordRef.current.length < 600) {
            ghostSampleClockRef.current = 0;
            ghostRecordRef.current.push({
              x: fallbackPlayerXRef.current,
              distance: Math.floor(distanceRef.current),
            });
          }
          while (
            ghostIndexRef.current < ghostPathRef.current.length - 1
            && ghostPathRef.current[ghostIndexRef.current].distance < distanceRef.current
          ) ghostIndexRef.current += 1;
          ghostPositionRef.current = ghostPathRef.current[ghostIndexRef.current] ?? null;
          if (nearbyDanger !== dangerRef.current) {
            dangerRef.current = nearbyDanger;
            dangerHandlerRef.current(nearbyDanger);
          }
          fallbackStatsClock += delta;
          if (fallbackStatsClock > 0.12) {
            fallbackStatsClock = 0;
            powersHandlerRef.current({
              nitro: nitroTimeRef.current,
              magnet: magnetTimeRef.current,
            });
            const missionTarget = missionTypeRef.current === "delivery" ? 90 : 20;
            const missionProgress = missionTypeRef.current === "delivery"
              ? Math.min(90, Math.floor(missionElapsedRef.current))
              : Math.min(20, missionOvertakesRef.current);
            missionHandlerRef.current({
              type: missionTypeRef.current,
              progress: missionProgress / missionTarget,
              completed: missionCompletedRef.current,
            });
            if (engineOscillatorRef.current && audioContextRef.current && soundOnRef.current) {
              const audioTime = audioContextRef.current.currentTime;
              engineOscillatorRef.current.frequency.setTargetAtTime(55 + speedRef.current * 3.1, audioTime, 0.08);
              engineGainRef.current?.gain.setTargetAtTime(phaseRef.current === "playing" ? 0.026 : 0, audioTime, 0.08);
            } else {
              engineGainRef.current?.gain.setTargetAtTime(0, audioContextRef.current?.currentTime ?? 0, 0.08);
            }
            statsHandlerRef.current({
              speed: Math.round(speedRef.current * 3.6),
              distance: Math.floor(distanceRef.current),
              score: Math.floor(scoreRef.current),
              coins: coinCountRef.current,
            });
          }
        }
        paintFallbackScene(host.clientWidth, host.clientHeight);
      };
      fallbackRaf = requestAnimationFrame(animateFallback);

      return () => {
        cancelAnimationFrame(fallbackRaf);
        fallbackObserver.disconnect();
        canvas.remove();
        fallbackObstaclesRef.current = [];
        fallbackPickupsRef.current = [];
        fallbackPowerupsRef.current = [];
      };
    }
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x172426);
    scene.fog = new THREE.Fog(0x172426, 27, 118);
    const camera = new THREE.PerspectiveCamera(59, 1, 0.1, 180);
    camera.position.set(0, 5.2, 10.8);
    camera.lookAt(0, 0.8, -13);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.16;
    renderer.setSize(host.clientWidth, host.clientHeight);
    host.appendChild(renderer.domElement);

    const ambient = new THREE.HemisphereLight(0xc2d8d0, 0x17201f, 1.35);
    scene.add(ambient);
    const moon = new THREE.DirectionalLight(0xffd6a0, 2.1);
    moon.position.set(-12, 24, 12);
    scene.add(moon);
    const skylineGlow = new THREE.PointLight(0xff705d, 18, 70, 2);
    skylineGlow.position.set(0, 3, -38);
    scene.add(skylineGlow);
    const playerHeadlights: THREE.SpotLight[] = [];

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(120, 230),
      new THREE.MeshStandardMaterial({ color: 0x263332, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, -0.1, -48);
    scene.add(ground);
    const road = new THREE.Mesh(
      new THREE.PlaneGeometry(10.5, 230),
      new THREE.MeshStandardMaterial({ color: 0x343b3a, roughness: 0.92, metalness: 0.04 }),
    );
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, 0, -48);
    scene.add(road);

    const lineMaterial = new THREE.MeshStandardMaterial({ color: 0xe2e5c8, emissive: 0x73764e, emissiveIntensity: 0.38, roughness: 0.8 });
    const rainPositions = new Float32Array(300 * 3);
    for (let index = 0; index < rainPositions.length; index += 3) {
      rainPositions[index] = (Math.random() - 0.5) * 22;
      rainPositions[index + 1] = 1 + Math.random() * 12;
      rainPositions[index + 2] = -58 + Math.random() * 74;
    }
    const rainGeometry = new THREE.BufferGeometry();
    rainGeometry.setAttribute("position", new THREE.BufferAttribute(rainPositions, 3));
    const rainMaterial = new THREE.PointsMaterial({
      color: 0xc7e2e9,
      size: 0.1,
      transparent: true,
      opacity: 0.56,
      depthWrite: false,
    });
    const rainEffect = new THREE.Points(rainGeometry, rainMaterial);
    rainEffect.visible = false;
    scene.add(rainEffect);

    const dashMeshes: THREE.Mesh[] = [];
    for (const x of [-1.75, 1.75]) {
      for (let i = 0; i < 24; i++) {
        const dash = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.022, 2.1), lineMaterial);
        dash.position.set(x, 0.018, 9 - i * 4.8);
        scene.add(dash);
        dashMeshes.push(dash);
      }
    }
    const curbMaterialA = new THREE.MeshStandardMaterial({ color: 0xd4d2b0, roughness: 0.8 });
    const curbMaterialB = new THREE.MeshStandardMaterial({ color: 0xc45b49, roughness: 0.8 });
    const curbs: THREE.Mesh[] = [];
    for (const x of [-5.37, 5.37]) {
      for (let i = 0; i < 36; i++) {
        const curb = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.16, 2.9), i % 2 ? curbMaterialA : curbMaterialB);
        curb.position.set(x, 0.07, 8 - i * 3.3);
        scene.add(curb);
        curbs.push(curb);
      }
    }

    const roadside: THREE.Group[] = [];
    const blockMaterials = [
      new THREE.MeshStandardMaterial({ color: 0x34413c, roughness: 1 }),
      new THREE.MeshStandardMaterial({ color: 0x3b3c36, roughness: 1 }),
      new THREE.MeshStandardMaterial({ color: 0x394a46, roughness: 1 }),
    ];
    for (let i = 0; i < 18; i++) {
      const side = i % 2 ? -1 : 1;
      const isLamp = i % 3 === 0;
      const object = isLamp ? createStreetlamp() : new THREE.Group();
      object.userData.isLamp = isLamp;
      if (!isLamp) {
        const width = 2 + Math.random() * 2.7;
        const height = 3.5 + Math.random() * 8;
        const building = new THREE.Mesh(
          new THREE.BoxGeometry(width, height, 3.5 + Math.random() * 5),
          blockMaterials[i % blockMaterials.length],
        );
        building.position.y = height / 2;
        object.add(building);
        for (let row = 0; row < Math.floor(height / 1.8); row++) {
          for (const wx of [-0.3, 0.3]) {
            const window = new THREE.Mesh(
              new THREE.BoxGeometry(0.23, 0.42, 0.035),
              new THREE.MeshBasicMaterial({ color: i % 4 === 1 ? 0xd9a46a : 0xa3bbb0, transparent: true, opacity: 0.5 }),
            );
            window.position.set(wx * width, 0.6 + row * 1.6, -1.77);
            object.add(window);
          }
        }
      }
      object.position.set(side * (isLamp ? 7.8 : 10 + Math.random() * 5), 0, -i * 12 - 3);
      object.userData.side = side;
      object.userData.recycleSpan = 216;
      scene.add(object);
      roadside.push(object);
    }

    const environmentPalette: Record<EnvironmentMode, {
      sky: number;
      fog: number;
      fogNear: number;
      fogFar: number;
      ground: number;
      road: number;
      ambient: number;
      moon: number;
      moonColor: number;
      skyline: number;
      buildings: number[];
      laneGlow: number;
    }> = {
      night: {
        sky: 0x172426, fog: 0x172426, fogNear: 27, fogFar: 118, ground: 0x263332, road: 0x343b3a,
        ambient: 1.35, moon: 2.1, moonColor: 0xffd6a0, skyline: 18,
        buildings: [0x34413c, 0x3b3c36, 0x394a46], laneGlow: 0.38,
      },
      day: {
        sky: 0x87b7c4, fog: 0xa5c0bb, fogNear: 52, fogFar: 165, ground: 0x657463, road: 0x505651,
        ambient: 2.2, moon: 0.55, moonColor: 0xfff1c8, skyline: 3,
        buildings: [0x69756c, 0x74786d, 0x5f716b], laneGlow: 0.12,
      },
      rain: {
        sky: 0x1b303b, fog: 0x24363d, fogNear: 18, fogFar: 92, ground: 0x243237, road: 0x2a393e,
        ambient: 1.25, moon: 1.15, moonColor: 0xb5d3dc, skyline: 12,
        buildings: [0x2f3e40, 0x354044, 0x324548], laneGlow: 0.48,
      },
      fog: {
        sky: 0x71817d, fog: 0xa0aaa1, fogNear: 8, fogFar: 56, ground: 0x56615a, road: 0x454e4a,
        ambient: 1.8, moon: 0.8, moonColor: 0xd9e0d0, skyline: 5,
        buildings: [0x59655f, 0x646a61, 0x53635e], laneGlow: 0.18,
      },
      sunrise: {
        sky: 0xd37d75, fog: 0xe6ae8e, fogNear: 44, fogFar: 145, ground: 0x70584c, road: 0x514643,
        ambient: 2.05, moon: 0.9, moonColor: 0xffc88b, skyline: 7,
        buildings: [0x6d5b54, 0x735b4e, 0x665b55], laneGlow: 0.22,
      },
      sunset: {
        sky: 0x4c526d, fog: 0xa16f68, fogNear: 32, fogFar: 115, ground: 0x4d4249, road: 0x34333d,
        ambient: 1.6, moon: 1.5, moonColor: 0xffa477, skyline: 12,
        buildings: [0x403e4c, 0x51434b, 0x46444e], laneGlow: 0.32,
      },
      "heavy-rain": {
        sky: 0x142832, fog: 0x1d3037, fogNear: 12, fogFar: 72, ground: 0x1b292e, road: 0x202f34,
        ambient: 1.05, moon: 0.75, moonColor: 0xa8c5d0, skyline: 8,
        buildings: [0x26373b, 0x2a383d, 0x24373b], laneGlow: 0.52,
      },
      "dense-fog": {
        sky: 0x89948e, fog: 0xb5beb5, fogNear: 3, fogFar: 30, ground: 0x646d66, road: 0x4b544e,
        ambient: 1.9, moon: 0.6, moonColor: 0xd8e2d5, skyline: 2,
        buildings: [0x747d75, 0x747970, 0x67746e], laneGlow: 0.12,
      },
    };
    const applyEnvironment = (mode: EnvironmentMode) => {
      const palette = environmentPalette[mode];
      scene.background = new THREE.Color(palette.sky);
      scene.fog = new THREE.Fog(palette.fog, palette.fogNear, palette.fogFar);
      ground.material.color.setHex(palette.ground);
      road.material.color.setHex(palette.road);
      ambient.intensity = palette.ambient;
      moon.intensity = palette.moon;
      moon.color.setHex(palette.moonColor);
      skylineGlow.intensity = palette.skyline;
      playerHeadlights.forEach((headlight) => {
        headlight.visible = ["night", "sunset", "rain", "heavy-rain", "fog", "dense-fog"].includes(mode);
        headlight.intensity = mode === "fog" || mode === "dense-fog" ? 25 : 18;
      });
      lineMaterial.emissiveIntensity = palette.laneGlow;
      blockMaterials.forEach((material, index) => material.color.setHex(palette.buildings[index]));
      curbMaterialA.color.setHex(mode === "day" ? 0xb8ae8f : 0xd4d2b0);
      curbMaterialB.color.setHex(mode === "day" ? 0x9e987e : 0xc45b49);
      roadside.forEach((object) => {
        if (object.userData.isLamp) object.visible = mode !== "day";
      });
      const rainy = mode === "rain" || mode === "heavy-rain";
      rainEffect.visible = rainy;
      rainGeometry.setDrawRange(0, mode === "heavy-rain" ? 300 : 180);
      rainMaterial.size = mode === "heavy-rain" ? 0.15 : 0.1;
      rainMaterial.opacity = mode === "heavy-rain" ? 0.75 : 0.56;
    };
    environmentHandlerRef.current = applyEnvironment;
    applyEnvironment(environmentRef.current);

    const initialPlayer = currentPlayerRef.current;
    const initialPaint = paintColors[initialPlayer?.paintColor ?? "lime"].three;
    const player = makeCar(initialPaint, true, false, initialPlayer?.selectedCar ?? "starter");
    player.position.set(0, 0, 2.2);
    scene.add(player);
    playerRef.current = player;
    for (const side of [-1, 1]) {
      const target = new THREE.Object3D();
      target.position.set(side * 0.46, 0.2, -22);
      player.add(target);
      const headlight = new THREE.SpotLight(0xfff0c5, 18, 42, 0.3, 0.78, 1.4);
      headlight.position.set(side * 0.47, 0.53, -1.26);
      headlight.target = target;
      headlight.visible = environmentRef.current !== "day";
      player.add(headlight);
      playerHeadlights.push(headlight);
    }
    const ghostCar = makeCar(0x8fe0e4);
    ghostCar.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => {
        material.transparent = true;
        material.opacity = 0.32;
        material.depthWrite = false;
        material.emissive.setHex(0x246b72);
        material.emissiveIntensity = 0.6;
      });
    });
    ghostCar.visible = false;
    scene.add(ghostCar);
    const policeCar = makePoliceCar();
    policeCar.position.set(0, 0, 8);
    policeCar.visible = false;
    scene.add(policeCar);
    policeCarRef.current = policeCar;
    const sparkGeometry = new THREE.BufferGeometry();
    const sparkPositions = new Float32Array(12 * 3);
    sparkGeometry.setAttribute("position", new THREE.BufferAttribute(sparkPositions, 3));
    const sparkMaterial = new THREE.PointsMaterial({
      color: 0xffc266,
      size: 0.3,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const dangerSparks = new THREE.Points(sparkGeometry, sparkMaterial);
    dangerSparks.visible = false;
    scene.add(dangerSparks);
    const obstacleColors = [0xb45b50, 0x7f9d96, 0xd6ae71, 0x728594, 0xa9a88b, 0x846c73];
    obstacleRefs.current = Array.from({ length: 9 }, (_, i) => {
      const kind: ObstacleKind = i % 5 === 0 ? "barrier" : i % 4 === 0 ? "truck" : "car";
      const direction = i % 2 ? "same" : "oncoming";
      const color = obstacleColors[i % obstacleColors.length];
      const mesh = kind === "barrier"
        ? makeBarrier()
        : kind === "truck"
          ? makeTruck(color)
          : makeCar(
            color,
            false,
            direction === "oncoming",
            i % 3 === 0 ? "rally" : i % 2 ? "sport" : "starter",
          );
      mesh.position.set([-3.3, 0, 3.3][i % 3], 0, -120 - i * 18);
      mesh.rotation.y = direction === "oncoming" ? Math.PI : 0;
      mesh.visible = false;
      scene.add(mesh);
      return {
        mesh,
        active: false,
        kind,
        lane: [-3.3, 0, 3.3][i % 3],
        direction,
        speedFactor: kind === "barrier" ? 1 : direction === "oncoming" ? 1.5 : 0.68,
        drift: kind === "barrier" ? 0 : 0.25,
        phase: i * 0.83,
      counted: false,
      };
    });
    coinRefs.current = Array.from({ length: 8 }, (_, i) => {
      const mesh = makeCoin();
      mesh.position.set([-3.3, 0, 3.3][i % 3], 0.85, -130 - i * 18);
      mesh.visible = false;
      scene.add(mesh);
      return { mesh, active: false };
    });
    powerupRefs.current = Array.from({ length: 4 }, (_, index) => {
      const kind: PowerupKind = index % 2 ? "magnet" : "nitro";
      const mesh = makePowerup(kind);
      mesh.position.set([-3.35, 0, 3.35][index % 3], 0.9, -145 - index * 24);
      mesh.visible = false;
      scene.add(mesh);
      return { mesh, active: false, kind };
    });

    const resize = () => {
      if (!host) return;
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.fov = width < 600 ? 64 : 59;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    let statsClock = 0;
    let elapsed = 0;
    const animate = (now: number) => {
      rafRef.current = requestAnimationFrame(animate);
      const delta = Math.min((now - (lastFrameRef.current || now)) / 1000, 0.04);
      lastFrameRef.current = now;
      const isPlaying = phaseRef.current === "playing";
      if (environmentRef.current === "rain" || environmentRef.current === "heavy-rain") {
        const heavyRain = environmentRef.current === "heavy-rain";
        for (let index = 0; index < (heavyRain ? rainPositions.length : 180 * 3); index += 3) {
          rainPositions[index + 1] -= delta * (heavyRain ? 26 : 17);
          rainPositions[index + 2] += delta * (heavyRain ? 5 : 3);
          if (rainPositions[index + 1] < 0.15 || rainPositions[index + 2] > 16) {
            rainPositions[index] = (Math.random() - 0.5) * 22;
            rainPositions[index + 1] = 7 + Math.random() * 7;
            rainPositions[index + 2] = -58 + Math.random() * 12;
          }
        }
        (rainGeometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      }
      if (isPlaying) {
        elapsed += delta;
        missionElapsedRef.current += delta;
        nitroTimeRef.current = Math.max(0, nitroTimeRef.current - delta);
        magnetTimeRef.current = Math.max(0, magnetTimeRef.current - delta);
        policeTimeRef.current = Math.max(0, policeTimeRef.current - delta);
        const input = inputRef.current;
        const profile = currentPlayerRef.current;
        const selectedStyle = carStyles[profile?.selectedCar ?? "starter"];
        const speedLimit = selectedStyle.maxSpeed + (profile?.speedUpgrade ?? 0) * 3.2
          + (nitroTimeRef.current > 0 ? 22 : 0);
        const acceleration = 15 + (profile?.accelerationUpgrade ?? 0) * 4;
        if (input.accelerate) speedRef.current = Math.min(speedLimit, speedRef.current + delta * acceleration);
        else speedRef.current = Math.max(18, speedRef.current - delta * 2.3);
        if (input.brake) speedRef.current = Math.max(8, speedRef.current - delta * 26);
        const direction = Number(input.right) - Number(input.left);
        const grip = selectedStyle.grip + (profile?.handlingUpgrade ?? 0) * 0.9
          - (environmentRef.current === "rain" || environmentRef.current === "heavy-rain" ? 1.25 : 0);
        steeringRef.current += (direction * grip - steeringRef.current) * Math.min(1, delta * 8);
        player.position.x = THREE.MathUtils.clamp(player.position.x + steeringRef.current * delta, -3.95, 3.95);
        player.rotation.z = THREE.MathUtils.lerp(player.rotation.z, -steeringRef.current * 0.026, delta * 5);
        player.position.y = Math.sin(elapsed * 10) * (speedRef.current / 46) * 0.018;
        const travel = speedRef.current * delta * 0.92;
        distanceRef.current += travel;
        scoreRef.current += travel * 0.9;

        for (const dash of dashMeshes) {
          dash.position.z += travel;
          if (dash.position.z > 12) dash.position.z -= 115.2;
        }
        for (const curb of curbs) {
          curb.position.z += travel;
          if (curb.position.z > 12) curb.position.z -= 118.8;
        }
        for (const object of roadside) {
          object.position.z += travel * 0.88;
          if (object.position.z > 16) object.position.z -= object.userData.recycleSpan;
        }
        coinSpawnTimerRef.current -= delta;
        if (coinSpawnTimerRef.current <= 0) {
          const available = coinRefs.current.filter((item) => !item.active || item.mesh.position.z > 10);
          const pickup = available[Math.floor(Math.random() * available.length)];
          if (pickup) {
            pickup.active = true;
            pickup.mesh.position.set([-3.35, 0, 3.35][Math.floor(Math.random() * 3)], 0.85, -82 - Math.random() * 20);
            pickup.mesh.rotation.set(0, 0, 0);
            pickup.mesh.visible = true;
          }
          coinSpawnTimerRef.current = 1.55 + Math.random() * 1.25;
        }
        for (const pickup of coinRefs.current) {
          if (!pickup.active) continue;
          pickup.mesh.position.z += travel * (0.88 + Math.min(0.2, distanceRef.current / 5000));
          if (magnetTimeRef.current > 0 && pickup.mesh.position.z > -32) {
            pickup.mesh.position.x += (player.position.x - pickup.mesh.position.x) * Math.min(1, delta * 2.4);
          }
          pickup.mesh.rotation.y += delta * 2.2;
          pickup.mesh.rotation.z = Math.sin(elapsed * 3 + pickup.mesh.position.z) * 0.12;
          if (pickup.mesh.position.z > 10) {
            pickup.active = false;
            pickup.mesh.visible = false;
            continue;
          }
          if (
            Math.abs(pickup.mesh.position.z - player.position.z) < 2.4
            && Math.abs(pickup.mesh.position.x - player.position.x) < 1.45
          ) {
            pickup.active = false;
            pickup.mesh.visible = false;
            coinCountRef.current += 1;
            scoreRef.current += 60;
            playSound("coin");
          }
        }
        powerupSpawnTimerRef.current -= delta;
        if (powerupSpawnTimerRef.current <= 0) {
          const available = powerupRefs.current.filter((item) => !item.active || item.mesh.position.z > 10);
          const pickup = available[Math.floor(Math.random() * available.length)];
          if (pickup) {
            pickup.active = true;
            pickup.mesh.position.set([-3.35, 0, 3.35][Math.floor(Math.random() * 3)], 0.9, -84 - Math.random() * 22);
            pickup.mesh.visible = true;
          }
          powerupSpawnTimerRef.current = 11 + Math.random() * 7;
        }
        for (const pickup of powerupRefs.current) {
          if (!pickup.active) continue;
          pickup.mesh.position.z += travel * (0.88 + Math.min(0.2, distanceRef.current / 5000));
          pickup.mesh.rotation.y += delta * 1.9;
          if (pickup.mesh.position.z > 10) {
            pickup.active = false;
            pickup.mesh.visible = false;
            continue;
          }
          if (
            Math.abs(pickup.mesh.position.z - player.position.z) < 2.5
            && Math.abs(pickup.mesh.position.x - player.position.x) < 1.65
          ) {
            pickup.active = false;
            pickup.mesh.visible = false;
            if (pickup.kind === "nitro") nitroTimeRef.current = 6;
            else magnetTimeRef.current = 8;
            playSound("power");
          }
        }
        spawnTimerRef.current -= delta;
        if (spawnTimerRef.current <= 0) {
          const available = obstacleRefs.current.filter((item) => !item.active);
          const slot = available[Math.floor(Math.random() * available.length)];
          if (slot) {
            slot.active = true;
            const lane = [-3.35, 0, 3.35][Math.floor(Math.random() * 3)];
            slot.lane = lane;
            slot.direction = Math.random() < 0.5 ? "oncoming" : "same";
            slot.speedFactor = slot.kind === "barrier" ? 1 : slot.direction === "oncoming" ? 1.5 : 0.68;
            slot.drift = slot.kind === "barrier" ? 0 : 0.2 + Math.random() * 0.2;
            slot.phase = Math.random() * Math.PI * 2;
            slot.counted = false;
            slot.mesh.position.x = lane;
            slot.mesh.position.z = -86 - Math.random() * 15;
            slot.mesh.rotation.y = slot.direction === "oncoming" ? Math.PI : 0;
            slot.mesh.visible = true;
            slot.mesh.traverse((part) => {
              if (!(part instanceof THREE.Mesh) || !part.userData.isHeadlamp) return;
              const materials = Array.isArray(part.material) ? part.material : [part.material];
              materials.forEach((material) => {
                material.color.setHex(slot.direction === "oncoming" ? 0xffdfa0 : 0xff6657);
                material.emissive.setHex(slot.direction === "oncoming" ? 0xf1a642 : 0x6a120d);
                material.emissiveIntensity = slot.direction === "oncoming" ? 2.5 : 0.5;
              });
            });
          }
          spawnTimerRef.current = Math.max(0.72, 1.42 - distanceRef.current / 2600) + Math.random() * 0.46;
        }
        let nearbyDanger = false;
        for (const item of obstacleRefs.current) {
          if (!item.active) continue;
          item.mesh.position.z += travel * item.speedFactor * (0.88 + Math.min(0.2, distanceRef.current / 5000));
          item.mesh.position.x = item.lane + Math.sin(elapsed * 1.2 + item.phase) * item.drift;
          if (!item.counted && item.mesh.position.z > player.position.z + 1.9 && item.kind !== "barrier") {
            item.counted = true;
            missionOvertakesRef.current += 1;
          }
          if (item.mesh.position.z > 10) {
            item.active = false;
            item.mesh.position.z = -140;
            item.mesh.visible = false;
          }
          const collisionWidth = item.kind === "barrier" ? 1.78 : item.kind === "truck" ? 1.62 : 1.35;
          const laneDistance = Math.abs(item.mesh.position.x - player.position.x);
          const nearDistance = Math.abs(item.mesh.position.z - player.position.z);
          if (nearDistance < 17 && nearDistance > 2.4 && laneDistance < collisionWidth + 1.2) nearbyDanger = true;
          if (nearDistance < 2.1 && laneDistance < collisionWidth) {
            if (nitroTimeRef.current > 0) {
              item.active = false;
              item.mesh.visible = false;
              triggerPoliceChase();
              playSound("impact");
              continue;
            }
            triggerPoliceChase();
            playSound("impact");
            statsHandlerRef.current({
              speed: Math.round(speedRef.current * 3.6),
              distance: Math.floor(distanceRef.current),
              score: Math.floor(scoreRef.current),
              coins: coinCountRef.current,
            });
            phaseHandlerRef.current("over");
            phaseRef.current = "over";
            inputRef.current = emptyInput();
            break;
          }
        }
        dangerSparks.visible = nearbyDanger;
        if (nearbyDanger) {
          dangerSparks.position.set(player.position.x, 0.38, player.position.z - 1.6);
          const positions = sparkGeometry.attributes.position as THREE.BufferAttribute;
          for (let index = 0; index < 12; index++) {
            positions.setXYZ(
              index,
              (Math.random() - 0.5) * 2.3,
              Math.random() * 1.4,
              -Math.random() * 1.8,
            );
          }
          positions.needsUpdate = true;
          sparkMaterial.opacity = 0.55 + Math.random() * 0.4;
        }
        if (nearbyDanger !== dangerRef.current) {
          dangerRef.current = nearbyDanger;
          dangerHandlerRef.current(nearbyDanger);
        }
        if (speedRef.current * 3.6 > 120) policeSpeedClockRef.current += delta;
        else policeSpeedClockRef.current = Math.max(0, policeSpeedClockRef.current - delta * 1.5);
        if (policeSpeedClockRef.current > 1.2 && policeTimeRef.current <= 0) policeTimeRef.current = 8;
        if (policeTimeRef.current > 0) {
          policeCar.visible = true;
          policeCar.position.x += (player.position.x - policeCar.position.x) * Math.min(1, delta * 1.1);
          policeCar.position.z = 7.8 + Math.sin(elapsed * 2.2) * 0.35;
          const beacons = policeCar.userData.beacons as THREE.Mesh[];
          beacons.forEach((beacon, index) => {
            const materials = Array.isArray(beacon.material) ? beacon.material : [beacon.material];
            const bright = Math.floor(elapsed * 8) % 2 === index;
            materials.forEach((material) => {
              if (material instanceof THREE.MeshStandardMaterial) {
                material.emissiveIntensity = bright ? 3.8 : 0.3;
              }
              material.opacity = bright ? 1 : 0.7;
            });
          });
          if (!policeActiveRef.current) {
            policeActiveRef.current = true;
            policeHandlerRef.current(true);
          }
        } else {
          policeCar.visible = false;
          if (policeActiveRef.current) {
            policeActiveRef.current = false;
            policeHandlerRef.current(false);
          }
        }
        if (!missionCompletedRef.current) {
          missionCompletedRef.current = missionTypeRef.current === "delivery"
            ? missionElapsedRef.current >= 90
            : missionOvertakesRef.current >= 20;
        }
        ghostSampleClockRef.current += delta;
        if (ghostSampleClockRef.current >= 0.25 && ghostRecordRef.current.length < 600) {
          ghostSampleClockRef.current = 0;
          ghostRecordRef.current.push({
            x: player.position.x,
            distance: Math.floor(distanceRef.current),
          });
        }
        while (
          ghostIndexRef.current < ghostPathRef.current.length - 1
          && ghostPathRef.current[ghostIndexRef.current].distance < distanceRef.current
        ) ghostIndexRef.current += 1;
        const ghostPoint = ghostPathRef.current[ghostIndexRef.current];
        ghostPositionRef.current = ghostPoint ?? null;
        if (ghostPoint) {
          ghostCar.visible = true;
          ghostCar.position.x = ghostPoint.x;
          ghostCar.position.z = THREE.MathUtils.clamp(
            player.position.z - (ghostPoint.distance - distanceRef.current) * 0.24,
            -32,
            7,
          );
          ghostCar.position.y = 0.04;
        } else {
          ghostCar.visible = false;
        }
        statsClock += delta;
        if (statsClock > 0.12) {
          statsClock = 0;
          powersHandlerRef.current({
            nitro: nitroTimeRef.current,
            magnet: magnetTimeRef.current,
          });
          const missionTarget = missionTypeRef.current === "delivery" ? 90 : 20;
          const missionProgress = missionTypeRef.current === "delivery"
            ? Math.min(90, Math.floor(missionElapsedRef.current))
            : Math.min(20, missionOvertakesRef.current);
          missionHandlerRef.current({
            type: missionTypeRef.current,
            progress: missionProgress / missionTarget,
            completed: missionCompletedRef.current,
          });
          if (engineOscillatorRef.current && audioContextRef.current && soundOnRef.current) {
            const audioTime = audioContextRef.current.currentTime;
            engineOscillatorRef.current.frequency.setTargetAtTime(55 + speedRef.current * 3.1, audioTime, 0.08);
            engineGainRef.current?.gain.setTargetAtTime(0.026, audioTime, 0.08);
          } else {
            engineGainRef.current?.gain.setTargetAtTime(0, audioContextRef.current?.currentTime ?? 0, 0.08);
          }
          statsHandlerRef.current({
            speed: Math.round(speedRef.current * 3.6),
            distance: Math.floor(distanceRef.current),
            score: Math.floor(scoreRef.current),
            coins: coinCountRef.current,
          });
        }
      }
      if (!isPlaying && policeActiveRef.current && policeCar.visible) {
        const beacons = policeCar.userData.beacons as THREE.Mesh[];
        beacons.forEach((beacon, index) => {
          const materials = Array.isArray(beacon.material) ? beacon.material : [beacon.material];
          const bright = Math.floor(now / 130) % 2 === index;
          materials.forEach((material) => {
            if (material instanceof THREE.MeshStandardMaterial) {
              material.emissiveIntensity = bright ? 3.8 : 0.3;
            }
            material.opacity = bright ? 1 : 0.7;
          });
        });
      }
      camera.position.x += (player.position.x * 0.15 - camera.position.x) * Math.min(1, delta * 2.4);
      camera.lookAt(player.position.x * 0.12, 0.9, -13);
      renderer.render(scene, camera);
    };
    rafRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(rafRef.current);
      observer.disconnect();
      renderer.dispose();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => material.dispose());
        }
      });
      host.removeChild(renderer.domElement);
      playerRef.current = null;
      policeCarRef.current = null;
      obstacleRefs.current = [];
      coinRefs.current = [];
      powerupRefs.current = [];
      environmentHandlerRef.current = () => {};
    };
  }, []);

  useEffect(() => {
    const setKey = (key: string, down: boolean) => {
      const normalized = key.toLowerCase();
      if (normalized === "arrowleft" || normalized === "a") keyboardInputRef.current.left = down;
      if (normalized === "arrowright" || normalized === "d") keyboardInputRef.current.right = down;
      if (normalized === "arrowup" || normalized === "w") keyboardInputRef.current.accelerate = down;
      if (normalized === "arrowdown" || normalized === "s") keyboardInputRef.current.brake = down;
      syncInput();
    };
    const onDown = (event: KeyboardEvent) => {
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " "].includes(event.key)) event.preventDefault();
      setKey(event.key, true);
      if (event.repeat) return;
      if (event.key === " " || event.key.toLowerCase() === "p") {
        if (phaseRef.current === "playing" || phaseRef.current === "paused") pauseGame();
      }
      if (event.key === "Enter") {
        if (phaseRef.current === "ready" || phaseRef.current === "over") resetGame();
        else if (phaseRef.current === "paused") updatePhase("playing");
      }
      if (event.key === "Escape" && phaseRef.current === "playing") updatePhase("paused");
    };
    const onUp = (event: KeyboardEvent) => setKey(event.key, false);
    const onBlur = () => {
      keyboardInputRef.current = emptyInput();
      touchInputRef.current = emptyInput();
      inputRef.current = emptyInput();
      setHeld([]);
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [pauseGame, resetGame, syncInput, updatePhase]);

  useEffect(() => () => {
    engineOscillatorRef.current?.stop();
    engineOscillatorRef.current = null;
    engineGainRef.current = null;
    void audioContextRef.current?.close();
    audioContextRef.current = null;
  }, []);

  useEffect(() => {
    const context = audioContextRef.current;
    const gain = engineGainRef.current;
    const oscillator = engineOscillatorRef.current;
    if (!context || !gain || !oscillator) return;
    const now = context.currentTime;
    gain.gain.setTargetAtTime(phase === "playing" ? 0.035 : 0, now, 0.12);
    oscillator.frequency.setTargetAtTime(48 + stats.speed * 0.28, now, 0.08);
  }, [phase, stats.speed]);

  const touchControl = (key: keyof InputState, isDown: boolean, label: string) => {
    touchInputRef.current[key] = isDown;
    syncInput();
    setHeld((current) => isDown
      ? current.includes(label) ? current : [...current, label]
      : current.filter((item) => item !== label));
  };

  const pressTouchControl = (event: ReactPointerEvent<HTMLButtonElement>, key: keyof InputState, label: string) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    touchControl(key, true, label);
  };

  const releaseTouchControl = (key: keyof InputState, label: string) => {
    touchControl(key, false, label);
  };

  const formatScore = (value: number) => new Intl.NumberFormat("ar").format(value);
  const speedDisplay = new Intl.NumberFormat("en", { maximumFractionDigits: 0 }).format(stats.speed);
  const needsPlayerLogin = phase === "ready" && !currentPlayer;
  const renderLeaderboard = (className: string) => (
    <section className={className} aria-label="أفضل ثلاث نتائج">
      <div className="night-run__leaderboard-heading">
        <span><Trophy size={14} aria-hidden="true" /> الصدارة</span>
        <span className="night-run__environment-chip">{environmentLabels[environment]}</span>
      </div>
      {leaderboard.length > 0 ? (
        <ol className="night-run__leaderboard-list">
          {leaderboard.map((entry, index) => (
            <li className={`night-run__leaderboard-item night-run__leaderboard-item--${index + 1}`} key={entry.id}>
              <span className="night-run__leaderboard-rank">{index + 1}</span>
              <span className="night-run__leaderboard-name">{entry.name}</span>
              <strong>{formatScore(entry.highScore)}</strong>
            </li>
          ))}
        </ol>
      ) : (
        <p className="night-run__leaderboard-empty" role="status">
          {scoreSaving
            ? "جارٍ حفظ نتيجتك…"
            : scoreSaveError || (leaderboardLoading ? "جارٍ تحميل الصدارة…" : leaderboardError || "لا توجد نتائج بعد.")}
        </p>
      )}
      {leaderboard.length > 0 && scoreSaving && <p className="night-run__leaderboard-status" role="status">جارٍ حفظ نتيجتك…</p>}
      {leaderboard.length > 0 && scoreSaveError && <p className="night-run__leaderboard-status" role="alert">{scoreSaveError}</p>}
    </section>
  );
  const renderPlayerRoster = (className: string, leaderboardClassName = "night-run__leaderboard") => (
    <section className={className} aria-label="قائمة اللاعبين المسجلين">
      <div className="night-run__player-roster-heading">
        <strong>اللاعبون</strong>
        <span>{new Intl.NumberFormat("ar").format(players.length)}</span>
      </div>
      {renderLeaderboard(leaderboardClassName)}
      {currentPlayer && <p className="night-run__player-roster-current">تلعب باسم: {currentPlayer.name}</p>}
      {players.length > 0 ? (
        <ol className="night-run__player-roster-list">
          {players.map((player) => <li key={player.id}>{player.name}</li>)}
        </ol>
      ) : (
        <p className="night-run__player-roster-empty">
          {playersLoading ? "جارٍ تحميل اللاعبين…" : playersError || "لا يوجد لاعبون مسجلون بعد."}
        </p>
      )}
      {players.length > 0 && playersError && (
        <p className="night-run__player-roster-empty" role="status">{playersError}</p>
      )}
    </section>
  );
  const panelActionCard = (
    title: string,
    detail: string,
    item: GarageItem,
    price: number,
    options: { owned?: boolean; selected?: boolean; unavailable?: boolean } = {},
  ) => (
    <article className={`night-run__shop-card ${options.selected ? "is-selected" : ""}`} key={item}>
      <div className="night-run__shop-card-copy">
        <strong>{title}</strong>
        <span>{detail}</span>
      </div>
      <button
        className="night-run__shop-action"
        type="button"
        disabled={Boolean(options.selected || options.unavailable || garagePending)}
        onClick={() => void handleGarageAction(item)}
      >
        {garagePending === item ? "جارٍ..." : options.selected ? "مفعّل" : options.owned ? "اختيار" : price ? `${formatScore(price)} عملة` : "مجاني"}
      </button>
    </article>
  );
  const renderGaragePanel = () => {
    if (!currentPlayer) return null;
    const { walletCoins, ownedCars, ownedItems } = currentPlayer;
    const cars = [
      { id: "starter" as const, label: carStyles.starter.label, price: 0, select: "select-starter" as GarageItem },
      { id: "sport" as const, label: carStyles.sport.label, price: carStyles.sport.price, select: "select-sport" as GarageItem },
      { id: "rally" as const, label: carStyles.rally.label, price: carStyles.rally.price, select: "select-rally" as GarageItem },
    ];
    const paints = [
      { id: "paint-lime" as GarageItem, label: paintColors.lime.label, price: 0, color: paintColors.lime.hex },
      { id: "paint-coral" as GarageItem, label: paintColors.coral.label, price: 220, color: paintColors.coral.hex },
      { id: "paint-cyan" as GarageItem, label: paintColors.cyan.label, price: 220, color: paintColors.cyan.hex },
      { id: "paint-violet" as GarageItem, label: paintColors.violet.label, price: 300, color: paintColors.violet.hex },
    ];
    const hasItem = (item: GarageItem) => ownedItems.includes(item) || ["paint-lime", "tint-clear", "rims-classic"].includes(item);
    const upgrades = [
      { item: "speed" as GarageItem, label: "السرعة القصوى", level: currentPlayer.speedUpgrade, max: 3, detail: "ارفع الحد الأعلى للسرعة." },
      { item: "acceleration" as GarageItem, label: "قوة التسارع", level: currentPlayer.accelerationUpgrade, max: 3, detail: "بلوغ السرعة القصوى بشكل أسرع." },
      { item: "handling" as GarageItem, label: "نظام التحكم", level: currentPlayer.handlingUpgrade, max: 3, detail: "استجابة أفضل عند الانعطاف." },
    ];
    return (
      <>
        <section className="night-run__panel-section">
          <div className="night-run__section-heading"><h3>ترقيات الأداء</h3><span>حتى المستوى 3</span></div>
          <div className="night-run__shop-grid">
            {upgrades.map((upgrade) => {
              const price = upgradePrices[upgrade.item as keyof typeof upgradePrices](upgrade.level);
              return panelActionCard(
                `${upgrade.label} · ${upgrade.level}/${upgrade.max}`,
                upgrade.detail,
                upgrade.item,
                price,
                { unavailable: upgrade.level >= upgrade.max || walletCoins < price },
              );
            })}
          </div>
        </section>
        <section className="night-run__panel-section">
          <div className="night-run__section-heading"><h3>السيارات</h3><span>اختر سيارتك للجولة القادمة</span></div>
          <div className="night-run__shop-grid">
            {cars.map((car) => {
              const owned = ownedCars.includes(car.id);
              return panelActionCard(
                car.label,
                `السرعة ${carStyles[car.id].maxSpeed} · التحكم ${carStyles[car.id].grip.toFixed(1)}`,
                owned ? car.select : car.id === "starter" ? car.select : car.id,
                car.price,
                { owned, selected: currentPlayer.selectedCar === car.id, unavailable: !owned && walletCoins < car.price },
              );
            })}
          </div>
        </section>
        <section className="night-run__panel-section">
          <div className="night-run__section-heading"><h3>لون الهيكل</h3><span>تعديل بصري</span></div>
          <div className="night-run__shop-grid">
            {paints.map((paint) => panelActionCard(
              paint.label,
              `لون الطلاء · ${paint.price ? `${paint.price} عملة` : "مجاني"}`,
              paint.id,
              paint.price,
              { owned: hasItem(paint.id), selected: currentPlayer.paintColor === paint.id.replace("paint-", ""), unavailable: !hasItem(paint.id) && walletCoins < paint.price },
            ))}
          </div>
        </section>
        <section className="night-run__panel-section">
          <div className="night-run__section-heading"><h3>الزجاج والجنوط</h3><span>لمساتك الأخيرة</span></div>
          <div className="night-run__shop-grid">
            {panelActionCard("زجاج شفاف", "المظهر الأصلي", "tint-clear", 0, {
              owned: true,
              selected: currentPlayer.windowTint === "clear",
            })}
            {panelActionCard("تظليل داكن", "زجاج داكن", "tint-dark", 180, {
              owned: hasItem("tint-dark"),
              selected: currentPlayer.windowTint === "dark",
              unavailable: !hasItem("tint-dark") && walletCoins < 180,
            })}
            {panelActionCard("جنوط كلاسيكية", "التصميم الأصلي", "rims-classic", 0, {
              owned: true,
              selected: currentPlayer.rimStyle === "classic",
            })}
            {panelActionCard("جنوط رياضية", "تصميم لامع", "rims-sport", 240, {
              owned: hasItem("rims-sport"),
              selected: currentPlayer.rimStyle === "sport",
              unavailable: !hasItem("rims-sport") && walletCoins < 240,
            })}
            {panelActionCard("جنوط رالي", "تصميم تركوازي", "rims-rally", 320, {
              owned: hasItem("rims-rally"),
              selected: currentPlayer.rimStyle === "rally",
              unavailable: !hasItem("rims-rally") && walletCoins < 320,
            })}
          </div>
        </section>
        {(garageMessage || garageError) && <p className={`night-run__inline-message ${garageError ? "is-error" : ""}`} role={garageError ? "alert" : "status"}>{garageError || garageMessage}</p>}
      </>
    );
  };
  const renderQuestsPanel = () => {
    const quests = currentPlayer?.dailyQuests;
    const coinProgress = Math.min(100, quests?.coinsCollected ?? 0);
    const distanceProgress = Math.min(500, quests?.bestNoCrashDistance ?? 0);
    const questRows = [
      {
        title: "اجمع 100 عملة",
        detail: `${formatScore(coinProgress)} / 100`,
        progress: coinProgress,
        target: 100,
        claimed: quests?.coinRewardClaimed ?? false,
      },
      {
        title: "قد لمسافة 500 متر دون اصطدام",
        detail: `${formatScore(distanceProgress)} / 500 م`,
        progress: distanceProgress,
        target: 500,
        claimed: quests?.distanceRewardClaimed ?? false,
      },
    ];
    return (
      <>
        <p className="night-run__panel-intro">تتجدد المهمات يومياً. تُضاف مكافأة 100 عملة تلقائياً بعد إنهاء الجولة التي تكمل فيها المهمة.</p>
        <section className="night-run__panel-section">
          <div className="night-run__quest-list">
            {questRows.map((quest) => (
              <article className="night-run__quest-card" key={quest.title}>
                <div className="night-run__quest-top">
                  <div><strong>{quest.title}</strong><span>{quest.detail}</span></div>
                  <span className={`night-run__quest-state ${quest.claimed ? "is-done" : ""}`}>
                    {quest.claimed ? <><Check size={13} /> مكتملة</> : <><span>+100</span><Coins size={13} /></>}
                  </span>
                </div>
                <div className="night-run__progress-track" role="progressbar" aria-label={quest.title} aria-valuemin={0} aria-valuemax={quest.target} aria-valuenow={quest.progress}>
                  <span style={{ width: `${Math.min(100, quest.progress / quest.target * 100)}%` }} />
                </div>
              </article>
            ))}
          </div>
        </section>
        <section className="night-run__panel-section">
          <div className="night-run__section-heading"><h3>مهمة الجولة</h3><span>{mission.completed ? "مكتملة" : "تقدّمك الحالي"}</span></div>
          <article className="night-run__quest-card">
            <div className="night-run__quest-top">
              <div>
                <strong>{mission.type === "delivery" ? "توصيل الشحنة خلال 90 ثانية" : "تجاوز 20 سيارة دون اصطدام"}</strong>
                <span>{mission.type === "delivery"
                  ? `${Math.min(90, Math.floor(mission.progress * 90))} / 90 ثانية`
                  : `${Math.min(20, Math.floor(mission.progress * 20))} / 20 سيارة`}</span>
              </div>
              <span className={`night-run__quest-state ${mission.completed ? "is-done" : ""}`}>
                {mission.completed ? <><Check size={13} /> +{mission.type === "delivery" ? 150 : 200}</> : "أثناء اللعب"}
              </span>
            </div>
            <div className="night-run__progress-track" role="progressbar" aria-label="تقدّم مهمة الجولة" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(mission.progress * 100)}>
              <span style={{ width: `${Math.min(100, mission.progress * 100)}%` }} />
            </div>
          </article>
          <p className="night-run__panel-footnote">اختر مهمة عشوائية في بداية كل جولة. تُصرف مكافأتها عند حفظ النتيجة.</p>
        </section>
      </>
    );
  };
  const renderFriendsPanel = () => {
    if (!currentPlayer) return null;
    const friendRanking = [
      { id: currentPlayer.id, name: currentPlayer.name, highScore: currentPlayer.highScore, isSelf: true },
      ...friendsData.friends.map((friend) => ({ ...friend, isSelf: false })),
    ].sort((left, right) => right.highScore - left.highScore || left.name.localeCompare(right.name));
    const visibleChallenges = friendsData.challenges.filter((challenge) =>
      ["pending", "active", "completed"].includes(challenge.status),
    );
    return (
      <>
        <p className="night-run__panel-intro">أضف أصدقاء برمزهم، وتابع نتائجهم أو أرسل تحدي مسافة سريعاً.</p>
        <section className="night-run__friend-code-card">
          <div><span>رمزك</span><strong dir="ltr">{currentPlayer.friendCode}</strong></div>
          <button className="night-run__secondary-button" type="button" onClick={() => void copyFriendCode()}><Copy size={15} /> نسخ الرمز</button>
        </section>
        <form className="night-run__friend-form" onSubmit={handleAddFriend}>
          <label htmlFor="night-run-friend-code">إضافة صديق برمزه</label>
          <div>
            <input
              id="night-run-friend-code"
              type="text"
              dir="ltr"
              autoComplete="off"
              maxLength={20}
              value={friendCodeInput}
              onChange={(event) => setFriendCodeInput(event.target.value)}
              placeholder="NR-..."
            />
            <button className="night-run__secondary-button" type="submit" disabled={friendActionPending || !friendCodeInput.trim()}>
              <Users size={15} /> إضافة
            </button>
          </div>
        </form>
        {(friendMessage || friendError) && <p className={`night-run__inline-message ${friendError ? "is-error" : ""}`} role={friendError ? "alert" : "status"}>{friendError || friendMessage}</p>}
        {friendsData.incomingRequests.length > 0 && (
          <section className="night-run__panel-section">
            <div className="night-run__section-heading"><h3>طلبات الصداقة</h3><span>{friendsData.incomingRequests.length}</span></div>
            <div className="night-run__social-list">
              {friendsData.incomingRequests.map((request) => (
                <article className="night-run__social-row" key={request.id}>
                  <div><strong>{request.name}</strong><span dir="ltr">{request.friendCode}</span></div>
                  <div className="night-run__row-actions">
                    <button className="night-run__mini-button is-positive" type="button" disabled={friendActionPending} onClick={() => void respondToFriendRequest(request.id, true)} aria-label={`قبول طلب ${request.name}`}><Check size={15} /></button>
                    <button className="night-run__mini-button" type="button" disabled={friendActionPending} onClick={() => void respondToFriendRequest(request.id, false)} aria-label={`رفض طلب ${request.name}`}><X size={15} /></button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}
        <section className="night-run__panel-section">
          <div className="night-run__section-heading"><h3>صدارة الأصدقاء</h3><span>{friendsData.friends.length} صديق</span></div>
          {friendRanking.length ? (
            <ol className="night-run__social-list night-run__friend-ranking">
              {friendRanking.map((friend, index) => (
                <li className="night-run__social-row" key={friend.id}>
                  <div><span className="night-run__rank-badge">{index + 1}</span><strong>{friend.name}{friend.isSelf ? " · أنت" : ""}</strong></div>
                  <strong className="night-run__friend-score">{formatScore(friend.highScore)}</strong>
                </li>
              ))}
            </ol>
          ) : <p className="night-run__panel-footnote">{friendsLoading ? "جارٍ تحميل الأصدقاء…" : "أضف أصدقاء لتظهر نتائجهم هنا."}</p>}
        </section>
        {friendsData.friends.length > 0 && (
          <section className="night-run__panel-section">
            <div className="night-run__section-heading"><h3>تحدي 100 متر</h3><span>75 عملة للفائز</span></div>
            <div className="night-run__social-list">
              {friendsData.friends.map((friend) => (
                <article className="night-run__social-row" key={friend.id}>
                  <div><strong>{friend.name}</strong><span>أفضل نتيجة {formatScore(friend.highScore)}</span></div>
                  <button className="night-run__secondary-button" type="button" disabled={friendActionPending} onClick={() => void createFriendChallenge(friend.id)}>
                    <Target size={14} /> تحدَّ
                  </button>
                </article>
              ))}
            </div>
          </section>
        )}
        {visibleChallenges.length > 0 && (
          <section className="night-run__panel-section">
            <div className="night-run__section-heading"><h3>التحديات</h3><span>{visibleChallenges.length}</span></div>
            <div className="night-run__social-list">
              {visibleChallenges.map((challenge) => {
                const isOpponent = challenge.opponentId === currentPlayer.id;
                const opponent = isOpponent ? challenge.challengerName : challenge.opponentName;
                const ownBest = isOpponent ? challenge.opponentBest : challenge.challengerBest;
                const friendBest = isOpponent ? challenge.challengerBest : challenge.opponentBest;
                return (
                  <article className="night-run__challenge-card" key={challenge.id}>
                    <div className="night-run__challenge-copy">
                      <strong>{challenge.status === "completed" ? "انتهى التحدي" : challenge.status === "active" ? `تحدي مع ${opponent}` : `دعوة من ${challenge.challengerName}`}</strong>
                      <span>
                        {challenge.status === "completed"
                          ? `الفائز: ${challenge.winnerId === currentPlayer.id ? "أنت" : challenge.winnerId === null ? "لا أحد" : opponent}`
                          : `أنت ${formatScore(ownBest)} م · ${opponent} ${formatScore(friendBest)} م / ${challenge.targetDistance} · ${challenge.rewardCoins} عملة`}
                      </span>
                    </div>
                    {challenge.status === "pending" && isOpponent && (
                      <div className="night-run__row-actions">
                        <button className="night-run__mini-button is-positive" type="button" disabled={friendActionPending} onClick={() => void respondToChallenge(challenge.id, true)} aria-label="قبول التحدي"><Check size={15} /></button>
                        <button className="night-run__mini-button" type="button" disabled={friendActionPending} onClick={() => void respondToChallenge(challenge.id, false)} aria-label="رفض التحدي"><X size={15} /></button>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </section>
        )}
        <button className="night-run__secondary-button night-run__share-button" type="button" onClick={() => void shareHighScore()}><Share2 size={15} /> مشاركة أعلى نتيجة</button>
        {shareMessage && <p className="night-run__inline-message" role="status">{shareMessage}</p>}
        {friendError && <p className="night-run__inline-message is-error" role="alert">{friendError}</p>}
      </>
    );
  };
  const renderFeaturePanel = () => {
    if (!activePanel) return null;
    const title = activePanel === "garage" ? "الجراج والتعديل" : activePanel === "quests" ? "المهمات والتحديات" : "الأصدقاء";
    const Icon = activePanel === "garage" ? Paintbrush : activePanel === "quests" ? Target : Users;
    return (
      <div className="night-run__panel-overlay">
        <section className="night-run__feature-panel" role="dialog" aria-modal="true" aria-labelledby="night-run-panel-title">
          <header className="night-run__feature-panel-head">
            <div className="night-run__feature-panel-title"><span><Icon size={18} /></span><div><h2 id="night-run-panel-title">{title}</h2><p>{currentPlayer ? `${currentPlayer.name} · ${formatScore(currentPlayer.walletCoins)} عملة` : "خطّ الليل"}</p></div></div>
            <button className="night-run__panel-close" type="button" onClick={closePanel} aria-label="إغلاق اللوحة"><X size={18} /></button>
          </header>
          <div className="night-run__panel-scroll">
            {activePanel === "garage" ? renderGaragePanel() : activePanel === "quests" ? renderQuestsPanel() : renderFriendsPanel()}
          </div>
        </section>
      </div>
    );
  };

  return (
    <main className={`night-run ${touchDevice ? "night-run--touch" : ""}`} dir="rtl" aria-label="لعبة خطّ الليل للسباق">
      <div className="night-run__scene" ref={sceneHost} aria-hidden="true" />

      <header className="night-run__topbar">
        <div className="night-run__brand">
          <div className="night-run__brand-mark" aria-hidden="true">خ</div>
          <div>
            <h1 className="night-run__brand-name">خطّ الليل</h1>
            <span className="night-run__brand-owner">عبدالرحمن سالم العنزي</span>
            <span className="night-run__brand-kicker">NIGHT RUN · شارع 09</span>
          </div>
        </div>
        <div className="night-run__top-actions">
          {currentPlayer && (
            <>
              <button className="night-run__icon-button night-run__quick-action" type="button" onClick={() => openPanel("garage")} aria-label="فتح الجراج" title="الجراج">
                <Wrench size={16} /><span>الجراج</span>
              </button>
              <button className="night-run__icon-button night-run__quick-action" type="button" onClick={() => openPanel("quests")} aria-label="فتح المهمات" title="المهمات">
                <Target size={16} /><span>المهمات</span>
              </button>
              <button className="night-run__icon-button night-run__quick-action" type="button" onClick={() => openPanel("friends")} aria-label="فتح الأصدقاء" title="الأصدقاء">
                <Users size={16} /><span>الأصدقاء</span>
              </button>
            </>
          )}
          {phase === "playing" && (
            <button className="night-run__icon-button" type="button" onClick={pauseGame} aria-label="إيقاف السباق مؤقتاً" title="إيقاف مؤقت">
              <Pause size={17} />
            </button>
          )}
          <button className="night-run__icon-button" type="button" onClick={toggleSound} aria-label={soundOn ? "إيقاف الصوت" : "تشغيل الصوت"} title={soundOn ? "إيقاف الصوت" : "تشغيل الصوت"}>
            {soundOn ? <Volume2 size={17} /> : <VolumeX size={17} />}
          </button>
        </div>
      </header>

      {danger && phase === "playing" && <div className="night-run__danger-flash" aria-hidden="true" />}
      {activeNotification && (
        <aside className="night-run__notification" role="status">
          <span className="night-run__notification-icon"><Bell size={16} /></span>
          <span>{activeNotification.message}</span>
          <button type="button" onClick={() => setActiveNotification(null)} aria-label="إخفاء الإشعار"><X size={15} /></button>
        </aside>
      )}
      <section className="night-run__hud" aria-label="إحصائيات السباق">
        <div className="night-run__metric">
          <span className="night-run__metric-label">المسافة</span>
          <div className="night-run__metric-value">{formatScore(stats.distance)} <small>م</small></div>
        </div>
        <div className="night-run__metric">
          <span className="night-run__metric-label">النقاط</span>
          <div className="night-run__metric-value">{formatScore(stats.score)} <small>PTS</small></div>
          <span className="night-run__metric-coins"><Coins size={13} aria-hidden="true" /> {formatScore(stats.coins)} عملة</span>
        </div>
      </section>

      <div className="night-run__speed-dial" aria-label={`السرعة ${speedDisplay} كيلومتراً في الساعة`}>
        <span className="night-run__speed-ticks" />
        <strong className="night-run__speed-number">{speedDisplay}</strong>
        <span className="night-run__speed-label">KM / H</span>
      </div>

      {phase === "playing" && (
        <>
          {(powerUps.nitro > 0 || powerUps.magnet > 0) && (
            <div className="night-run__power-status" aria-label="المكافآت النشطة">
              {powerUps.nitro > 0 && <span className="is-nitro"><Zap size={14} /> نيترو {Math.ceil(powerUps.nitro)}ث</span>}
              {powerUps.magnet > 0 && <span className="is-magnet"><Magnet size={14} /> مغناطيس {Math.ceil(powerUps.magnet)}ث</span>}
            </div>
          )}
          <div className={`night-run__mission-chip ${mission.completed ? "is-complete" : ""}`}>
            <span>{mission.type === "delivery" ? "توصيل الشحنة" : "تجاوز السيارات"}</span>
            <strong>{mission.completed ? "مكتملة" : mission.type === "delivery" ? `${Math.floor(mission.progress * 90)}/90ث` : `${Math.floor(mission.progress * 20)}/20`}</strong>
          </div>
          {ghostName && <div className="night-run__ghost-chip">شبح أفضل جولة · {ghostName}</div>}
        </>
      )}
      {policeChase && phase !== "ready" && (
        <div className="night-run__police-chip">
          <Sparkles size={14} /> {phase === "over" ? "استدعيت الشرطة بعد الاصطدام" : "مطاردة الشرطة"}
        </div>
      )}

      <footer className="night-run__bottom">
        <div className="night-run__hint">
          <span className="night-run__hint-mark" />
          <span>اجمع العملات وتفادَ السيارات والحواجز.</span>
          <span className="night-run__hint-mapping" aria-label="المثلث للتسارع، إكس للفرملة، المربع لليسار، والدائرة لليمين">
            <Triangle className="night-run__symbol-icon night-run__symbol-icon--triangle" size={15} />
            <span>تسارع</span>
            <X className="night-run__symbol-icon night-run__symbol-icon--cross" size={15} />
            <span>فرامل</span>
            <Square className="night-run__symbol-icon night-run__symbol-icon--square" size={14} />
            <span>يسار</span>
            <Circle className="night-run__symbol-icon night-run__symbol-icon--circle" size={15} />
            <span>يمين</span>
          </span>
        </div>
        <div className="night-run__touch-controls" aria-label="أدوات التحكم باللمس">
          <div className="night-run__playstation-controls" aria-label="أزرار التحكم بالرموز">
            <button
              className={`night-run__symbol-button night-run__symbol-button--triangle ${held.includes("triangle") ? "is-held" : ""}`}
              type="button"
              aria-label="المثلث: تسارع"
              onPointerDown={(event) => pressTouchControl(event, "accelerate", "triangle")}
              onPointerUp={() => releaseTouchControl("accelerate", "triangle")}
              onPointerCancel={() => releaseTouchControl("accelerate", "triangle")}
              onLostPointerCapture={() => releaseTouchControl("accelerate", "triangle")}
            ><Triangle size={33} strokeWidth={3.2} /></button>
            <button
              className={`night-run__symbol-button night-run__symbol-button--square ${held.includes("square") ? "is-held" : ""}`}
              type="button"
              aria-label="المربع: انعطاف يساراً"
              onPointerDown={(event) => pressTouchControl(event, "left", "square")}
              onPointerUp={() => releaseTouchControl("left", "square")}
              onPointerCancel={() => releaseTouchControl("left", "square")}
              onLostPointerCapture={() => releaseTouchControl("left", "square")}
            ><Square size={32} strokeWidth={3.2} /></button>
            <button
              className={`night-run__symbol-button night-run__symbol-button--circle ${held.includes("circle") ? "is-held" : ""}`}
              type="button"
              aria-label="الدائرة: انعطاف يميناً"
              onPointerDown={(event) => pressTouchControl(event, "right", "circle")}
              onPointerUp={() => releaseTouchControl("right", "circle")}
              onPointerCancel={() => releaseTouchControl("right", "circle")}
              onLostPointerCapture={() => releaseTouchControl("right", "circle")}
            ><Circle size={35} strokeWidth={3.2} /></button>
            <button
              className={`night-run__symbol-button night-run__symbol-button--cross ${held.includes("cross") ? "is-held" : ""}`}
              type="button"
              aria-label="إكس: فرملة"
              onPointerDown={(event) => pressTouchControl(event, "brake", "cross")}
              onPointerUp={() => releaseTouchControl("brake", "cross")}
              onPointerCancel={() => releaseTouchControl("brake", "cross")}
              onLostPointerCapture={() => releaseTouchControl("brake", "cross")}
            ><X size={39} strokeWidth={3.2} /></button>
          </div>
        </div>
      </footer>

      {sceneError && <div className="night-run__scene-error" role="alert">تعذّر تشغيل المشهد ثلاثي الأبعاد. جرّب متصفحاً يدعم WebGL.</div>}

      {renderFeaturePanel()}

      {phase !== "playing" && !activePanel && (
        <div className="night-run__overlay">
          <section className="night-run__dialog" role="dialog" aria-modal="true" aria-labelledby="night-run-title">
            <p className="night-run__eyebrow">{needsPlayerLogin ? "PLAYER SIGN-IN · NIGHT RUN" : phase === "ready" ? "AFTER DARK · 01" : phase === "paused" ? "RACE PAUSED" : phase === "over" ? "RUN ENDED" : "NIGHT RUN"}</p>
            <h2 className="night-run__dialog-title" id="night-run-title">
              {needsPlayerLogin ? "اكتب اسمك قبل القيادة." : phase === "ready" ? "الشارع لك الآن." : phase === "paused" ? "خذ نفساً." : "انتهى المشوار."}
            </h2>
            <p className="night-run__dialog-copy">
              {needsPlayerLogin
                ? "سجّل باسمك لتبدأ السباق، واجمع العملات لرفع نتيجتك. ستظهر أفضل النتائج للجميع."
                : phase === "ready"
                ? "اجمع العملات، وتفادَ السيارات والحواجز. تتغير أجواء الطريق مع كل جولة."
                : phase === "paused"
                  ? "توقّف كل شيء. عندما تكون جاهزاً، عد إلى خطّ الليل."
                  : "اقتربت كثيراً من الزحام. جرّب مرة ثانية، وحافظ على مسافة أوسع."}
            </p>
            {needsPlayerLogin ? (
              <>
                <form className="night-run__login-form" onSubmit={handlePlayerLogin}>
                  <label className="night-run__login-label" htmlFor="night-run-player-name">اسم اللاعب</label>
                  <input
                    className="night-run__login-input"
                    id="night-run-player-name"
                    type="text"
                    name="playerName"
                    autoComplete="nickname"
                    dir="auto"
                    maxLength={32}
                    required
                    value={playerNameInput}
                    onChange={(event) => setPlayerNameInput(event.target.value)}
                    placeholder="اكتب اسمك هنا"
                    aria-describedby="night-run-player-note"
                  />
                  {loginError && <p className="night-run__login-error" role="alert">{loginError}</p>}
                  <button className="night-run__primary-button" type="submit" disabled={loginPending}>
                    <span>{loginPending ? "جارٍ تسجيل دخولك…" : "سجّل وابدأ اللعب"}</span>
                    <span><ArrowLeft size={19} /></span>
                  </button>
                </form>
                {renderPlayerRoster("night-run__player-roster night-run__player-roster--dialog")}
                <p className="night-run__pause-note" id="night-run-player-note">لا تحتاج إلى كلمة مرور، وسيظهر اسمك لجميع اللاعبين.</p>
              </>
            ) : (
              <>
                {phase === "ready" && (
                  <div className="night-run__instructions">
                    <div className="night-run__instruction">
                      <span className="night-run__instruction-symbols">
                        <Square className="night-run__symbol-icon night-run__symbol-icon--square" size={17} />
                        <Circle className="night-run__symbol-icon night-run__symbol-icon--circle" size={18} />
                      </span>
                      <span>توجيه السيارة</span>
                    </div>
                    <div className="night-run__instruction">
                      <span className="night-run__instruction-symbols">
                        <Triangle className="night-run__symbol-icon night-run__symbol-icon--triangle" size={18} />
                        <X className="night-run__symbol-icon night-run__symbol-icon--cross" size={19} />
                      </span>
                      <span>تسارع وفرملة</span>
                    </div>
                  </div>
                )}
                {phase === "over" && (
                  <>
                    <div className="night-run__score-block">
                      <span>نتيجتك في هذا المشوار</span>
                      <strong>{formatScore(stats.score)}</strong>
                      <small><Coins size={13} aria-hidden="true" /> {formatScore(stats.coins)} عملة مجمّعة</small>
                    </div>
                    <button className="night-run__secondary-button night-run__share-button" type="button" onClick={() => void shareHighScore()}><Share2 size={15} /> مشاركة أعلى نتيجة</button>
                    {shareMessage && <p className="night-run__inline-message" role="status">{shareMessage}</p>}
                    {renderPlayerRoster(
                      "night-run__player-roster night-run__player-roster--dialog",
                      "night-run__leaderboard night-run__leaderboard--dialog",
                    )}
                  </>
                )}
                <button className="night-run__primary-button" type="button" onClick={() => phase === "paused" ? updatePhase("playing") : resetGame()}>
                  <span>{phase === "ready" ? "ابدأ القيادة" : phase === "paused" ? "تابع القيادة" : "جولة جديدة"}</span>
                  <span>{phase === "paused" ? <Play size={18} /> : phase === "over" ? <RotateCcw size={18} /> : <ArrowLeft size={19} />}</span>
                </button>
                <div className="night-run__pause-note">{phase === "paused" ? "استخدم زر المتابعة للرجوع للسباق" : currentPlayer ? `تلعب باسم: ${currentPlayer.name}` : "△ تسارع · × فرامل · □ يسار · ○ يمين"}</div>
              </>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
