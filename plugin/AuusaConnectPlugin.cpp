#define NOMINMAX
#include "bakkesmod/plugin/bakkesmodplugin.h"
#include "bakkesmod/wrappers/WrapperStructs.h"
#include "bakkesmod/wrappers/MatchmakingWrapper.h"
#include <cpr/cpr.h>
#include <nlohmann/json.hpp>
#include <vector>
#include <string>
#include <fstream>
#include <filesystem>
#include <map>
#include <cmath>
#include <algorithm>
#include <utility>
#include <thread>
#include <memory>
#include <exception>
#include <windows.h>
#include <bcrypt.h>
#include <iomanip>
#include <sstream>
#include <cstdlib>

#undef min
#undef max

using json = nlohmann::json;

static std::string hmac_sha256(const std::string& key, const std::string& data)
{
    BCRYPT_ALG_HANDLE hAlg = nullptr;
    BCRYPT_HASH_HANDLE hHash = nullptr;
    DWORD objLen = 0, dataLen = 0;
    std::vector<BYTE> obj; // buffer pour l'objet de hachage
    BYTE hash[32];

    NTSTATUS status = BCryptOpenAlgorithmProvider(&hAlg, BCRYPT_SHA256_ALGORITHM, nullptr,
                                                   BCRYPT_ALG_HANDLE_HMAC_FLAG);
    if (!BCRYPT_SUCCESS(status))
        throw std::runtime_error("BCryptOpenAlgorithmProvider failed");

    status = BCryptGetProperty(hAlg, BCRYPT_OBJECT_LENGTH,
                               reinterpret_cast<PBYTE>(&objLen), sizeof(DWORD), &dataLen, 0);
    if (!BCRYPT_SUCCESS(status)) {
        BCryptCloseAlgorithmProvider(hAlg, 0);
        throw std::runtime_error("BCryptGetProperty failed");
    }

    obj.resize(objLen);
    status = BCryptCreateHash(hAlg, &hHash, obj.data(), objLen,
                              reinterpret_cast<PBYTE>(const_cast<char*>(key.data())),
                              static_cast<ULONG>(key.size()), 0);
    if (!BCRYPT_SUCCESS(status)) {
        BCryptCloseAlgorithmProvider(hAlg, 0);
        throw std::runtime_error("BCryptCreateHash failed");
    }

    status = BCryptHashData(hHash, reinterpret_cast<PBYTE>(const_cast<char*>(data.data())),
                            static_cast<ULONG>(data.size()), 0);
    if (!BCRYPT_SUCCESS(status)) {
        BCryptDestroyHash(hHash);
        BCryptCloseAlgorithmProvider(hAlg, 0);
        throw std::runtime_error("BCryptHashData failed");
    }

    status = BCryptFinishHash(hHash, hash, sizeof(hash), 0);
    BCryptDestroyHash(hHash);
    BCryptCloseAlgorithmProvider(hAlg, 0);
    if (!BCRYPT_SUCCESS(status))
        throw std::runtime_error("BCryptFinishHash failed");

    std::ostringstream oss;
    for (BYTE b : hash)
        oss << std::hex << std::setw(2) << std::setfill('0') << static_cast<int>(b);
    return oss.str();
}

struct PlayerStats
{
    int boostPickups = 0;
    int wastedBoosts = 0;
    int smallPads = 0;
    int bigPads = 0;
    float lastBoost = -1.f;

    // Statistiques offensives
    int goals = 0;
    int assists = 0;
    int shotsOnTarget = 0;
    int offensiveDemos = 0;

    // Statistiques defensives
    int clearances = 0;
    int challengesWon = 0;
    int defensiveDemos = 0;
    float defenseTime = 0.f;
    int clutchSaves = 0;
    int blocks = 0;

    // Vision & soutien
    int usefulPasses = 0;
    int cleanClears = 0;
    int missedOpenGoals = 0;
    int doubleCommits = 0;
    int aerialTouches = 0;
    int highPressings = 0;
    int ballTouches = 0;

    // Suivi des roles de rotation
    float roleTime[3] = {0.f, 0.f, 0.f};
    int cuts = 0;
    float aggressiveTime = 0.f;
    float passiveTime = 0.f;
    float ballchaseTime = 0.f;
    int lastRole = -1;
    float firstStreak = 0.f;
    float thirdStreak = 0.f;

    // Etats internes
    bool inAttack = false;
    float timeSinceAttack = 0.f;
    int prevSaves = 0;

    // Garde-fous pour la comptabilisation des evenements
    float lastDuelTime = -10.f;
    float lastMissedOpenGoalTime = -10.f;
    float lastHighPressTime = -10.f;

    std::vector<float> xgAttempts;
    std::vector<std::string> xgContext;
};

struct DefenderInfo {
    Vector pos;
    float boost;
    bool padNearby;
    float distance;
};

class AuusaConnectPlugin : public BakkesMod::Plugin::BakkesModPlugin
{
public:
    void onLoad() override;
    void onUnload() override;

private:
    void HookEvents();
    void OnMatchStart(ServerWrapper server, void* params, std::string eventName);
    void TickStats();
    void OnHitBall(CarWrapper car, void* params, std::string eventName);
    void OnCarDemolish(CarWrapper car, void* params, std::string eventName);
    void OnBoostCollected(CarWrapper car, void* params, std::string eventName);
    void OnGameEnd();
    void OnGoalScored(std::string eventName);
    std::string DetectShotContext(CarWrapper car, BallWrapper ball, int team, bool openNet, float gameTime, bool isAerial);
    static float ComputeXGAdvanced(float distance, float angle, float ballSpeed, float playerBoost, bool isAerial, const std::vector<DefenderInfo>& defenders, bool hardRebound, bool panicShot, bool openNet, bool qualityAction);

    void PollSupabase();
    void LoadConfig();

    std::map<std::string, PlayerStats> stats;
    std::string lastTouchPlayer;
    float lastTouchTime = 0.f;
    bool lastTouchAerial = false;
    std::string lastTeamTouchPlayer[2];
    float lastTeamTouchTime[2] = {0.f, 0.f};
    Vector lastBallLocation{0.f, 0.f, 0.f};
    Vector lastBallVel;
    float lastUpdate = 0.f;
    int lastTotalScore = 0;
    bool debugEnabled = false;
    std::ofstream logFile;
    void Log(const std::string& msg);
    std::string lastServerName;
    std::string lastServerPassword;
    bool apiDisabled = false;
    std::string botEndpoint = "https://34.32.118.126:3000/match";
    std::string apiSecret;
    bool creatingMatch = false;
    bool autoJoined = false;
};

static PriWrapper GetPriByName(ServerWrapper server, const std::string& name)
{
    ArrayWrapper<PriWrapper> pris = server.GetPRIs();
    for (int i = 0; i < pris.Count(); ++i)
    {
        PriWrapper pri = pris.Get(i);
        if (pri && pri.GetPlayerName().ToString() == name)
            return pri;
    }
    // Constructeur par défaut non disponible, on renvoie un wrapper nul
    return PriWrapper(0);
}

static bool WasLastShotOnGoal(const BallWrapper& ball)
{
    // Cette fonction est absente dans certaines versions du SDK.
    // On renvoie simplement false si elle n'est pas disponible.
    return false;
}

float AuusaConnectPlugin::ComputeXGAdvanced(float distance, float angle, float ballSpeed, float playerBoost, bool isAerial, const std::vector<DefenderInfo>& defenders, bool hardRebound, bool panicShot, bool openNet, bool qualityAction)
{
    float xg = 0.05f;
    xg += std::exp(-distance / 2500.f) * 0.25f;
    xg += std::clamp(1.f - angle / 1.57f, 0.f, 1.f) * 0.2f;
    xg += std::clamp(ballSpeed / 4000.f, 0.f, 1.f) * 0.05f;
    if (playerBoost > 20.f)
        xg += 0.02f;

    float openBonus = 0.f;
    if (openNet)
    {
        openBonus = 0.25f;
        for (const auto& d : defenders)
        {
            if (d.distance < 1000.f)
                openBonus -= 0.1f;
            else if (d.distance < 1500.f)
                openBonus -= 0.05f;
        }
        if (openBonus > 0.f)
            xg += openBonus;
    }

    int defCount = 0;
    for (const auto& d : defenders)
    {
        if (d.distance < 1500.f && d.boost > 30.f && defCount < 3)
        {
            xg -= 0.04f;
            ++defCount;
        }
    }

    if (hardRebound)
        xg -= 0.05f;
    if (panicShot)
        xg -= 0.05f;
    if (qualityAction)
        xg += 0.05f;

    return std::clamp(xg, 0.f, 0.95f);
}

std::string AuusaConnectPlugin::DetectShotContext(CarWrapper car, BallWrapper ball, int team, bool openNet, float gameTime, bool isAerial)
{
    std::vector<std::string> ctx;
    BoostWrapper boost = car.GetBoostComponent();
    float b = boost ? boost.GetCurrentBoostAmount() : 0.f;
    Vector vel = ball.GetVelocity();

    if (lastTouchPlayer == car.GetPRI().GetPlayerName().ToString() && gameTime - lastTouchTime < 1.f && lastTouchAerial && isAerial)
        ctx.push_back("double_tap");

    if (b < 5.f && vel.magnitude() > 2500.f)
        ctx.push_back("panic_shot");

    float targetY = team == 0 ? 5120.f : -5120.f;
    if (std::fabs(lastBallLocation.Y - targetY) < 300.f && std::fabs(lastBallLocation.Z) > 800.f)
        ctx.push_back("backboard");

    if (!lastTouchPlayer.empty() && lastTouchPlayer != car.GetPRI().GetPlayerName().ToString())
    {
        PriWrapper prevPri = GetPriByName(gameWrapper->GetCurrentGameState(), lastTouchPlayer);
        if (prevPri && prevPri.GetTeamNum2() == team && gameTime - lastTouchTime < 1.5f && std::fabs(ball.GetLocation().X) < 700.f)
            ctx.push_back("perfect_center");
    }

    if (openNet)
        ctx.push_back("open_net");

    if (isAerial)
        ctx.push_back("aerial");

    std::string res;
    for (size_t i = 0; i < ctx.size(); ++i)
    {
        res += ctx[i];
        if (i + 1 < ctx.size())
            res += " + ";
    }
    return res;
}

void AuusaConnectPlugin::onLoad()
{
    cvarManager->registerCvar("mm_debug", "0", "Active le mode debug").addOnValueChanged([this](std::string, CVarWrapper cvar){
        debugEnabled = cvar.getBoolValue();
    });
    cvarManager->registerCvar("mm_player_id", "unknown", "Pseudo du joueur en jeu")
        .addOnValueChanged([this](std::string, CVarWrapper cvar){
            std::string val = cvar.getStringValue();
            if(!val.empty() && val != "unknown")
            {
                apiDisabled = false;
                PollSupabase();
            }
        });

    std::string playerName = gameWrapper->GetPlayerName().ToString();
    if (!playerName.empty())
        cvarManager->getCvar("mm_player_id").setValue(playerName);
    else
        Log("[Init] Impossible de recuperer le pseudo du joueur");
    cvarManager->registerNotifier(
        "mm_show_credentials",
        [this](std::vector<std::string>) {
            if (lastServerName.empty())
                Log("Aucun credential en memoire");
            else
                Log("rl_name=" + lastServerName + ", rl_password=" + lastServerPassword);
        },
        "Affiche les dernieres informations recuperees depuis le serveur",
        PERMISSION_ALL);
    cvarManager->registerNotifier(
        "mm_help",
        [this](std::vector<std::string>) {
            Log("mm_player_id est automatiquement defini sur votre pseudo in-game");
        },
        "Affiche l'aide de configuration du matchmaking",
        PERMISSION_ALL);
    cvarManager->registerNotifier(
        "mm_poll_now",
        [this](std::vector<std::string>) { PollSupabase(); },
        "Force une verification immediate du serveur",
        PERMISSION_ALL);
    debugEnabled = cvarManager->getCvar("mm_debug").getBoolValue();
    std::filesystem::path logPath = gameWrapper->GetDataFolder() / "matchmaking.log";
    logFile.open(logPath.string(), std::ios::app);
    Log("Plugin loaded");
    LoadConfig();
    HookEvents();

    PollSupabase();
}

void AuusaConnectPlugin::onUnload()
{
    Log("Plugin unloaded");
    if (logFile.is_open())
        logFile.close();
}

void AuusaConnectPlugin::LoadConfig()
{
    auto getEnv = [](const char* key) -> std::string {
        const char* val = std::getenv(key);
        return val ? std::string(val) : std::string();
    };

    botEndpoint = getEnv("BOT_ENDPOINT");
    apiSecret = getEnv("API_SECRET");

    std::filesystem::path path = gameWrapper->GetDataFolder() / "config.json";
    if (botEndpoint.empty() || apiSecret.empty())
    {
        std::ifstream file(path);
        if (!file.is_open())
        {
            Log("[Config] Impossible de lire " + path.string());
        }
        else
        {
            json cfg = json::parse(file, nullptr, false);
            if (cfg.is_discarded())
            {
                Log("[Config] JSON invalide dans " + path.string());
            }
            else
            {
                if (botEndpoint.empty()) botEndpoint = cfg.value("BOT_ENDPOINT", "");
                if (apiSecret.empty()) apiSecret = cfg.value("API_SECRET", "");

                for (auto& [key, val] : cfg.items())
                {
                    if (key.rfind("SUPABASE_", 0) == 0)
                        Log("[Config] Champ " + key + " obsolète ignoré");
                }
            }
        }
    }

    if (botEndpoint.empty())
        botEndpoint = "https://34.32.118.126:3000/match";
    if (botEndpoint.rfind("https://", 0) != 0)
        Log("[Config] BOT_ENDPOINT doit utiliser HTTPS");

    Log("[Config] BOT_ENDPOINT=" + botEndpoint);
    if (apiSecret.empty())
        Log("[Config] API_SECRET manquant");
}

void AuusaConnectPlugin::PollSupabase()
{
    if (apiDisabled)
        return;

    if (creatingMatch)
    {
        Log("[API] Requête ignorée : match en cours de création");
        gameWrapper->SetTimeout(std::bind(&AuusaConnectPlugin::PollSupabase, this), 3.0f);
        return;
    }

    if (autoJoined)
    {
        Log("[API] Requête ignorée : en attente de rejoindre la partie");
        gameWrapper->SetTimeout(std::bind(&AuusaConnectPlugin::PollSupabase, this), 3.0f);
        return;
    }

    // Ne pas interroger le serveur si l'on est déjà dans une partie en ligne.
    // `IsInGame()` renvoie également vrai en entraînement ou en freeplay,
    // ce qui empêchait toute requête lorsqu'on attendait dans ces modes.
    if (gameWrapper->IsInOnlineGame())
    {
        Log("[API] Requête ignorée : déjà en partie en ligne");
        gameWrapper->SetTimeout(std::bind(&AuusaConnectPlugin::PollSupabase, this), 3.0f);
        return;
    }

    std::string playerId = cvarManager->getCvar("mm_player_id").getStringValue();
    if (playerId.empty() || playerId == "unknown")
    {
        Log("mm_player_id manquant ou \"unknown\". Le pseudo du joueur n'a pas pu etre recupere.");
        apiDisabled = true;
        return;
    }
    gameWrapper->SetTimeout(std::bind(&AuusaConnectPlugin::PollSupabase, this), 3.0f);

    std::thread([this, playerId]() {
        try
        {
            cpr::Response r = cpr::Get(
                cpr::Url{"https://34.32.118.126:3000/player"},
                cpr::Parameters{{"player_id", playerId}},
                cpr::VerifySsl{true});
            if (r.error.code != cpr::ErrorCode::OK)
            {
                Log(std::string("[API] Erreur reseau : ") + r.error.message);
                return;
            }
            if (r.status_code != 200)
            {
                Log("[API] Erreur HTTP " + std::to_string(r.status_code) + ": " + r.text);
                return;
            }
            auto instr = json::parse(r.text, nullptr, false);
            if (!instr.is_object())
            {
                Log("[API] Réponse JSON vide ou invalide: " + r.text);
                return;
            }
            std::string name = instr.value("rl_name", "");
            std::string password = instr.value("rl_password", "");
            std::string queueType = instr.value("queue_type", "");
            if (name.empty())
            {
                Log("[API] Champ rl_name absent, aucune action");
                return;
            }
            lastServerName = name;
            lastServerPassword = password;
            Log("[API] rl_name=" + name + ", rl_password=" + password);
            if (!queueType.empty())
            {
                gameWrapper->Execute([this, name, password](GameWrapper* gw) {
                    auto mm = gw->GetMatchmakingWrapper();
                    if (mm)
                    {
                        CustomMatchSettings settings{};
                        settings.ServerName = name;
                        settings.Password = password;
                        settings.MapName = "Stadium_P";
                        settings.MaxPlayerCount = 2; // 1v1
                        creatingMatch = true;
                        mm.CreatePrivateMatch(Region::EU, static_cast<int>(PlaylistIds::PrivateMatch), settings);
                        gw->Toast("AuusaConnect", "\xF0\x9F\x8E\xAE Partie créée automatiquement", "default", 3.0f);
                    }
                });
            }
            else if (!autoJoined)
            {
                autoJoined = true;
                gameWrapper->Execute([this, name, password](GameWrapper* gw) {
                    auto mm = gw->GetMatchmakingWrapper();
                    if (mm)
                    {
                        mm.JoinPrivateMatch(name, password);
                        gw->Toast("AuusaConnect", "\xF0\x9F\x8E\xAE Partie rejointe automatiquement", "default", 3.0f);
                    }
                });
            }

        }
        catch (const std::exception& e)
        {
            Log(std::string("[API] Exception: ") + e.what());
        }
        catch (...)
        {
            Log("[API] Exception inconnue lors de la requete");
        }
    }).detach();
}

void AuusaConnectPlugin::HookEvents()
{
    gameWrapper->HookEventWithCallerPost<ServerWrapper>(
        "Function TAGame.GameEvent_Soccar_TA.EventMatchStarted",
        std::bind(&AuusaConnectPlugin::OnMatchStart, this,
                  std::placeholders::_1, std::placeholders::_2, std::placeholders::_3));
    Log("[HOOK] EventMatchStarted OK");

    gameWrapper->HookEventPost(
        "Function TAGame.GameEvent_Soccar_TA.EventMatchEnded",
        std::bind(&AuusaConnectPlugin::OnGameEnd, this));
    Log("[HOOK] EventMatchEnded OK");

    gameWrapper->HookEventWithCallerPost<CarWrapper>(
        "Function TAGame.Car_TA.OnHitBall",
        std::bind(&AuusaConnectPlugin::OnHitBall, this,
                  std::placeholders::_1, std::placeholders::_2, std::placeholders::_3));
    Log("[HOOK] OnHitBall OK");

    gameWrapper->HookEventWithCallerPost<CarWrapper>(
        "Function TAGame.Car_TA.EventDemolished",
        std::bind(&AuusaConnectPlugin::OnCarDemolish, this,
                  std::placeholders::_1, std::placeholders::_2, std::placeholders::_3));
    Log("[HOOK] EventDemolished OK");

    gameWrapper->HookEventWithCallerPost<ActorWrapper>(
        "Function TAGame.VehiclePickup_Boost_TA.Pickup",
        [this](ActorWrapper /*pickup*/, void* params, std::string eventName) {
            // Si aucun paramètre n'est fourni, on construit un CarWrapper invalide
            CarWrapper car = params ? CarWrapper(*reinterpret_cast<uintptr_t*>(params)) : CarWrapper(0);
            OnBoostCollected(car, params, eventName);
        });
    Log("[HOOK] BoostPickup OK");

    gameWrapper->HookEventPost(
        "Function TAGame.GameEvent_Soccar_TA.EventGoalScored",
        std::bind(&AuusaConnectPlugin::OnGoalScored, this, std::placeholders::_1));
    Log("[HOOK] EventGoalScored OK");
    // On gère les démolitions directement dans OnCarDemolish,
    // cette écoute n'est plus nécessaire.
}

void AuusaConnectPlugin::OnMatchStart(ServerWrapper server, void* /*params*/, std::string /*eventName*/)
{
    lastTotalScore = 0;
    stats.clear();
    lastUpdate = 0.f;
    lastTouchPlayer.clear();
    lastTouchTime = 0.f;
    lastTeamTouchPlayer[0].clear();
    lastTeamTouchPlayer[1].clear();
    lastTeamTouchTime[0] = lastTeamTouchTime[1] = 0.f;
    lastBallLocation = server.GetBall().GetLocation();
    ArrayWrapper<PriWrapper> pris = server.GetPRIs();
    for (int i = 0; i < pris.Count(); ++i)
    {
        PriWrapper pri = pris.Get(i);
        if (!pri)
            continue;
        CarWrapper car = pri.GetCar();
        if (!car)
            continue;
        BoostWrapper boost = car.GetBoostComponent();
        if (!boost)
            continue;
        stats[pri.GetPlayerName().ToString()].lastBoost = boost.GetCurrentBoostAmount();
    }

    TickStats();
}

void AuusaConnectPlugin::TickStats()
{
    ServerWrapper sw = gameWrapper->GetCurrentGameState();
    if (sw)
    {
        float now = sw.GetSecondsElapsed();
        float dt = lastUpdate > 0.f ? now - lastUpdate : 0.f;
        lastUpdate = now;

        BallWrapper ball = sw.GetBall();
        if (ball)
            lastBallVel = ball.GetVelocity();

        ArrayWrapper<PriWrapper> pris = sw.GetPRIs();
        Vector ballLoc = ball.GetLocation();
        std::vector<std::pair<PriWrapper, float>> teamPlayers[2];
        for (int i = 0; i < pris.Count(); ++i)
        {
            PriWrapper pri = pris.Get(i);
            if (!pri)
                continue;

            std::string name = pri.GetPlayerName().ToString();
            CarWrapper car = pri.GetCar();
            if (!car)
                continue;
            BoostWrapper boost = car.GetBoostComponent();

            PlayerStats &ps = stats[name];
            if (boost)
            {
                // Mise a jour simple de la valeur actuelle pour permettre un suivi correct
                // dans l'evenement OnBoostCollected sans compter deux fois les pickups.
                ps.lastBoost = boost.GetCurrentBoostAmount();
            }

            Vector pos = car.GetLocation();
            int team = pri.GetTeamNum2();
            bool playerInOppHalf = (team == 0 && pos.Y > 0) || (team == 1 && pos.Y < 0);
            bool ballInOppHalf = (team == 0 && ballLoc.Y > 0) || (team == 1 && ballLoc.Y < 0);
            bool recentlyTouched = (lastTouchPlayer == name && now - lastTouchTime < 0.5f);
            bool cooldown = (now - ps.lastHighPressTime < 2.f);
            bool oppClose = false;

            if (playerInOppHalf && ballInOppHalf && !recentlyTouched && !cooldown)
            {
                PriWrapper possPri = GetPriByName(sw, lastTouchPlayer);
                if (possPri && possPri.GetTeamNum2() != team)
                {
                    CarWrapper oppCar = possPri.GetCar();
                    if (oppCar)
                    {
                        Vector oppPos = oppCar.GetLocation();
                        float oppDist = (oppPos - pos).magnitude();
                        bool between = (team == 0) ? (oppPos.Y < pos.Y) : (oppPos.Y > pos.Y);
                        if (oppDist < 2000.f && between)
                            oppClose = true;
                    }
                }
            }

            if (oppClose)
            {
                ps.highPressings++;
                ps.lastHighPressTime = now;
                if (debugEnabled) Log("[DEBUG] High pressing compté pour " + name);
            }
            bool inDef = (team == 0) ? pos.Y < 0 : pos.Y > 0;
            if (inDef)
                ps.defenseTime += dt;

            int saves = pri.GetMatchSaves();
            if (saves > ps.prevSaves)
            {
                ps.prevSaves = saves;
                bool lastDef = true;
                for (int j = 0; j < pris.Count(); ++j)
                {
                    if (j == i)
                        continue;
                    PriWrapper mate = pris.Get(j);
                    if (!mate || mate.GetTeamNum2() != team)
                        continue;
                    CarWrapper mcar = mate.GetCar();
                    if (!mcar)
                        continue;
                    Vector mpos = mcar.GetLocation();
                    if ((team == 0 && mpos.Y < pos.Y) || (team == 1 && mpos.Y > pos.Y))
                    {
                        lastDef = false;
                        break;
                    }
                }
                if (lastDef)
                    ps.clutchSaves++;
            }

            float dist = (pos - ballLoc).magnitude();
            teamPlayers[team].push_back({pri, dist});
        }

        for (int t = 0; t < 2; ++t)
        {
            auto &vec = teamPlayers[t];
            std::sort(vec.begin(), vec.end(), [](const auto &a, const auto &b){ return a.second < b.second; });
            for (size_t j = 0; j < vec.size(); ++j)
            {
                PriWrapper pri = vec[j].first;
                if (!pri)
                    continue;
                std::string name = pri.GetPlayerName().ToString();
                PlayerStats &ps = stats[name];

                int role = static_cast<int>(j) + 1;
                if (role <= 3)
                    ps.roleTime[role - 1] += dt;

                ps.timeSinceAttack += dt;

                if (ps.lastRole != -1 && role < ps.lastRole - 1)
                    ps.cuts++;

                if (role == 1)
                    ps.firstStreak += dt;
                else
                {
                    if (ps.firstStreak > 5.f)
                        ps.aggressiveTime += ps.firstStreak;
                    ps.firstStreak = 0.f;
                }

                if (role == 3)
                    ps.thirdStreak += dt;
                else
                {
                    if (ps.thirdStreak > 5.f)
                        ps.passiveTime += ps.thirdStreak;
                    ps.thirdStreak = 0.f;
                }

                if (ps.inAttack)
                {
                    if (ps.timeSinceAttack > 3.f && role != 3)
                        ps.ballchaseTime += dt;
                    if (role == 3 && ps.timeSinceAttack > 1.f)
                        ps.inAttack = false;
                }

                ps.lastRole = role;
            }
        }
    }
    gameWrapper->SetTimeout(std::bind(&AuusaConnectPlugin::TickStats, this), 0.1f);
}

void AuusaConnectPlugin::OnGameEnd()
{
    try
    {
        Log("[OnGameEnd] Debut du traitement");

        creatingMatch = false;
        autoJoined = false;

        // Nettoie les cvars Rocket League afin d'eviter toute reutilisation accidentelle
        auto clearCvar = [this](const std::string& name)
        {
            CVarWrapper cv = cvarManager->getCvar(name);
            if (!cv.IsNull())
                cv.setValue("");
        };
        clearCvar("rl_name");
        clearCvar("rl_password");
        clearCvar("queue_type");

        lastServerName.clear();
        lastServerPassword.clear();

        ServerWrapper sw = gameWrapper->GetCurrentGameState();
        if (!sw)
            return;

    if (gameWrapper->IsInFreeplay())
    {
        Log("Statistiques non generees : session freeplay");
        return;
    }

    ArrayWrapper<PriWrapper> prisCheck = sw.GetPRIs();
    if (prisCheck.Count() < 2)
    {
        Log("Statistiques non generees : nombre de joueurs insuffisant pour analyser un match.");
        return;
    }


    TeamWrapper blueTeam = sw.GetTeams().Get(0);
    TeamWrapper orangeTeam = sw.GetTeams().Get(1);

    int scoreBlue = blueTeam.GetScore();
    int scoreOrange = orangeTeam.GetScore();

    std::string blueName = blueTeam.GetTeamName().ToString();
    std::string orangeName = orangeTeam.GetTeamName().ToString();
    std::string mapName = gameWrapper->GetCurrentMap();

    ArrayWrapper<PriWrapper> pris = sw.GetPRIs();
    json players = json::array();
    json scorers = json::array();
    std::string mvp = "";
    int bestScore = -1;

    for (int i = 0; i < pris.Count(); ++i)
    {
        PriWrapper pri = pris.Get(i);
        if (!pri)
            continue;

        std::string pname = pri.GetPlayerName().ToString();
        PlayerStats ps = stats[pname];
        // Utilise directement le temps total de jeu expose par ServerWrapper
        float totalTime = sw.GetTotalGameTimePlayed();
        float rTotal = ps.roleTime[0] + ps.roleTime[1] + ps.roleTime[2];
        float ideal = rTotal / 3.f;
        float diff = rTotal > 0.f ? (fabs(ps.roleTime[0] - ideal) + fabs(ps.roleTime[1] - ideal) + fabs(ps.roleTime[2] - ideal)) / rTotal : 0.f;
        float defenseRatio = totalTime > 0.f ? ps.defenseTime / totalTime : 0.f;
        float scoreRot = 100.f - diff * 40.f - ps.cuts * 5.f
                         - ps.aggressiveTime * 10.f - ps.passiveTime * 10.f
                         - ps.ballchaseTime * 15.f
                         - ps.doubleCommits * 3.f
                         - fabs(defenseRatio - 0.5f) * 30.f;
        scoreRot = std::clamp(scoreRot, 0.f, 100.f);

        float xgTotal = 0.f;
        for (float v : ps.xgAttempts)
            xgTotal += v;

        json p = {
            {"name", pname},
            {"team", pri.GetTeamNum2()},
            {"goals", ps.goals > 0 ? ps.goals : pri.GetMatchGoals()},
            {"assists", ps.assists > 0 ? ps.assists : pri.GetMatchAssists()},
            {"shots", ps.shotsOnTarget > 0 ? ps.shotsOnTarget : pri.GetMatchShots()},
            {"saves", pri.GetMatchSaves()},
            {"score", pri.GetMatchScore()},
            {"boostPickups", ps.boostPickups},
            {"wastedBoostPickups", ps.wastedBoosts},
            {"boostFrequency", totalTime > 0 ? ps.boostPickups / totalTime : 0},
            {"rotationQuality", scoreRot / 100.f},
            {"role1Frequency", rTotal > 0.f ? ps.roleTime[0] / rTotal : 0.f},
            {"role2Frequency", rTotal > 0.f ? ps.roleTime[1] / rTotal : 0.f},
            {"role3Frequency", rTotal > 0.f ? ps.roleTime[2] / rTotal : 0.f},
            {"cuts", ps.cuts},
            {"clearances", ps.clearances},
            {"defensiveChallenges", ps.challengesWon},
            {"defensiveDemos", ps.defensiveDemos},
            {"defenseTime", ps.defenseTime},
            {"clutchSaves", ps.clutchSaves},
            {"blocks", ps.blocks},
            {"ballTouches", ps.ballTouches},
            {"highPressings", ps.highPressings},
            {"aerialTouches", ps.aerialTouches},
            {"missedOpenGoals", ps.missedOpenGoals},
            {"doubleCommits", ps.doubleCommits},
            {"xg", xgTotal}
        };
        players.push_back(p);

        if ((ps.goals > 0 ? ps.goals : pri.GetMatchGoals()) > 0)
            scorers.push_back(pri.GetPlayerName().ToString());

        if (pri.GetMatchScore() > bestScore)
        {
            bestScore = pri.GetMatchScore();
            mvp = pri.GetPlayerName().ToString();
        }
    }

    float matchTime = sw.GetSecondsElapsed();
    int overtime = std::max(0, static_cast<int>(std::round(matchTime - 300.f)));

    json payload = {
        {"scoreBlue", scoreBlue},
        {"scoreOrange", scoreOrange},
        {"teamBlue", blueName},
        {"teamOrange", orangeName},
        {"map", mapName},
        {"scorers", scorers},
        {"mvp", mvp},
        {"players", players},
        {"overtime", overtime}
    };

    if (debugEnabled)
        Log("[DEBUG] Envoi des stats : " + std::to_string(players.size()) + " joueurs");

    gameWrapper->SetTimeout([this, payload = std::move(payload), url = botEndpoint](GameWrapper* /*gw*/) mutable
    {
        std::thread([this, p = std::move(payload), url]() mutable
        {
            try
            {
                std::string body = p.dump();
                cpr::Header headers{{"Content-Type", "application/json"}};
                if (!apiSecret.empty())
                    headers.emplace("x-signature", hmac_sha256(apiSecret, body));
                auto res = cpr::Post(
                    cpr::Url{url},
                    cpr::Body{body},
                    headers,
                    cpr::VerifySsl{true});

                if (res.error.code != cpr::ErrorCode::OK)
                    Log(std::string("[Stats] Erreur reseau : ") + res.error.message);
                else if (res.status_code >= 200 && res.status_code < 300)
                    Log("[Stats] Envoi reussi");
                else
                    Log("[Stats] Erreur HTTP " + std::to_string(res.status_code) + ": " + res.text);
            }
            catch (const std::exception& e)
            {
                Log(std::string("[Stats] Exception lors de l'envoi : ") + e.what());
            }
            catch (...)
            {
                Log("[Stats] Exception inconnue lors de l'envoi");
            }
        }).detach();
    }, 1.5f);
        Log("[OnGameEnd] Traitement termine");
    }
    catch (const std::exception& e)
    {
        Log(std::string("[ERREUR] Exception OnGameEnd : ") + e.what());
    }
    catch (...)
    {
        Log("[ERREUR] Exception inconnue dans OnGameEnd");
    }
}

void AuusaConnectPlugin::OnHitBall(CarWrapper car, void* /*params*/, std::string /*eventName*/)
{
    if (!car)
        return;

    PriWrapper pri = car.GetPRI();
    if (!pri)
        return;

    ServerWrapper sw = gameWrapper->GetCurrentGameState();
    if (!sw)
        return;

    BallWrapper ball = sw.GetBall();
    if (!ball)
        return;

    ArrayWrapper<PriWrapper> pris = sw.GetPRIs();
    float now = sw.GetSecondsElapsed();

    std::string name = pri.GetPlayerName().ToString();
    PlayerStats &ps = stats[name];

    Vector pos = car.GetLocation();
    Vector ballPos = ball.GetLocation();
    Vector ballVel = ball.GetVelocity();
    BoostWrapper boostComp = car.GetBoostComponent();
    float playerBoost = boostComp ? boostComp.GetCurrentBoostAmount() : 0.f;
    bool isAerial = !car.AnyWheelTouchingGround();
    int team = pri.GetTeamNum2();

    bool wasDef = (team == 0) ? lastBallLocation.Y < -2000.f : lastBallLocation.Y > 2000.f;
    bool nowOff = (team == 0) ? ballPos.Y > 0.f : ballPos.Y < 0.f;
    if (wasDef && nowOff)
    {
        ps.clearances++;
        if (debugEnabled)
            Log("[DEBUG] Degagement par " + name);
    }

    bool oppNearby = false;
    for (int i = 0; i < pris.Count(); ++i)
    {
        PriWrapper opp = pris.Get(i);
        if (!opp || opp.GetTeamNum2() == team)
            continue;
        CarWrapper oc = opp.GetCar();
        if (!oc)
            continue;
        if ((oc.GetLocation() - ballPos).magnitude() < 800.f)
        {
            oppNearby = true;
            break;
        }
    }
    float oppTouch = fabs(now - lastTeamTouchTime[team == 0 ? 1 : 0]);
    if (oppNearby && oppTouch < 0.2f)
    {
        if (now - ps.lastDuelTime >= 1.0f)
        {
            ps.challengesWon++;
            ps.lastDuelTime = now;
            if (debugEnabled)
            {
                Log("[DEBUG] Duel gagne par " + name);
                Log("[DEBUG] Duel compté");
            }
        }
    }

    // block si la balle allait vers le but et repart a l'oppose
    if ((team == 0 && lastBallVel.Y < 0 && ballVel.Y >= 0 && pos.Y < 0) ||
        (team == 1 && lastBallVel.Y > 0 && ballVel.Y <= 0 && pos.Y > 0))
    {
        ps.blocks++;
        if (debugEnabled)
            Log("[DEBUG] Block par " + name);
    }

    float gameTime = now;

    // Passe utile
    if (!lastTouchPlayer.empty() && lastTouchPlayer != name)
    {
        PriWrapper prevPri = GetPriByName(sw, lastTouchPlayer);
        if (prevPri && prevPri.GetTeamNum2() == pri.GetTeamNum2() && gameTime - lastTouchTime < 2.f)
            stats[lastTouchPlayer].usefulPasses++;
    }

    lastTouchPlayer = name;
    lastTouchTime = gameTime;
    lastTouchAerial = isAerial;
    lastTeamTouchPlayer[team] = name;
    lastTeamTouchTime[team] = gameTime;

    ps.ballTouches++;
    ps.inAttack = true;
    ps.timeSinceAttack = 0.f;

    if (WasLastShotOnGoal(ball))
        ps.shotsOnTarget++;

    Vector prevBall = lastBallLocation;
    Vector newBall = ball.GetLocation();
    if ((team == 0 && prevBall.X < 0 && newBall.X > 0) ||
        (team == 1 && prevBall.X > 0 && newBall.X < 0))
        ps.cleanClears++;

    bool shot = WasLastShotOnGoal(ball);
    if (!shot)
    {
        Vector goal = {0.f, team == 0 ? 5120.f : -5120.f, 0.f};
        Vector toGoal = goal - ballPos;
        toGoal.Z = 0.f;
        Vector dir = ballVel;
        dir.Z = 0.f;
        if (((team == 0 && ballVel.Y > 0) || (team == 1 && ballVel.Y < 0)) && dir.magnitude() > 0.1f && toGoal.magnitude() > 0.1f)
        {
            dir.normalize();
            toGoal.normalize();
            float dotVal = Vector::dot(dir, toGoal);
            float ang = acosf(std::clamp(dotVal, -1.f, 1.f));
            if (ang < 0.35f && std::fabs(ballPos.X) < 900.f)
                shot = true;
        }
    }

    if (shot)
    {
        std::vector<DefenderInfo> defenders;
        bool openNet = true;
        for (int i = 0; i < pris.Count(); ++i)
        {
            PriWrapper opp = pris.Get(i);
            if (!opp || opp.GetTeamNum2() == team)
                continue;
            CarWrapper oc = opp.GetCar();
            if (!oc)
                continue;
            Vector opos = oc.GetLocation();
            float distToShooter = (opos - pos).magnitude();
            if (distToShooter < 2000.f)
            {
                BoostWrapper ob = oc.GetBoostComponent();
                float oboost = ob ? ob.GetCurrentBoostAmount() : 0.f;
                defenders.push_back({opos, oboost, false, distToShooter});
            }
            if (((team == 0 && opos.Y > ballPos.Y) || (team == 1 && opos.Y < ballPos.Y)) &&
                std::fabs(opos.X - ballPos.X) < 800.f && (oc.GetBoostComponent() ? oc.GetBoostComponent().GetCurrentBoostAmount() : 0.f) > 5.f)
            {
                openNet = false;
            }
        }
        if (openNet)
        {
            if (gameTime - ps.lastMissedOpenGoalTime >= 2.0f)
            {
                ps.missedOpenGoals++;
                ps.lastMissedOpenGoalTime = gameTime;
                if (debugEnabled)
                    Log("[DEBUG] Open goal raté compté");
            }
        }

        std::string context = DetectShotContext(car, ball, team, openNet, gameTime, isAerial);
        bool quality = context.find("double_tap") != std::string::npos || context.find("perfect_center") != std::string::npos;
        bool hardRebound = ballVel.magnitude() > 2000.f && std::fabs(ballVel.Z) > 500.f;
        bool panicShot = playerBoost < 5.f && ballVel.magnitude() > 2500.f;
        Vector goal = {0.f, team == 0 ? 5120.f : -5120.f, 0.f};
        float distance = (pos - goal).magnitude();
        Vector toGoal = goal - ballPos;
        float angle = 0.f;
        if (ballVel.magnitude() > 0.1f && toGoal.magnitude() > 0.1f) {
            Vector velNorm = ballVel;
            velNorm.normalize();
            toGoal.normalize();
            float dotVal = Vector::dot(velNorm, toGoal);
            angle = acosf(std::clamp(dotVal, -1.f, 1.f));
        }

        float xg = ComputeXGAdvanced(distance, angle, ballVel.magnitude(), playerBoost, isAerial, defenders, hardRebound, panicShot, openNet, quality);
        ps.xgAttempts.push_back(xg);
        ps.xgContext.push_back(context);
        if (WasLastShotOnGoal(ball))
            ps.shotsOnTarget++;
    }

    Vector loc = car.GetLocation();
    for (int i = 0; i < pris.Count(); ++i)
    {
        PriWrapper other = pris.Get(i);
        if (!other || other.GetTeamNum2() != team || other.GetPlayerName().ToString() == name)
            continue;
        CarWrapper otherCar = other.GetCar();
        if (!otherCar)
            continue;
        float dist = (otherCar.GetLocation() - loc).magnitude();
        if (dist < 800.f && fabs(lastTeamTouchTime[team] - gameTime) < 0.5f)
        {
            stats[name].doubleCommits++;
            stats[other.GetPlayerName().ToString()].doubleCommits++;
            break;
        }
    }

    Vector ballLoc = ball.GetLocation();
    lastBallLocation = ballLoc;

    if (!car.AnyWheelTouchingGround())
        ps.aerialTouches++;

}

void AuusaConnectPlugin::OnCarDemolish(CarWrapper car, void* /*params*/, std::string /*eventName*/)
{
    if (!car)
        return;

    PriWrapper pri = car.GetPRI();
    if (!pri)
        return;

    PriWrapper attacker = car.GetAttackerPRI();
    if (attacker)
    {
        CarWrapper ac = attacker.GetCar();
        if (ac)
        {
            Vector aloc = ac.GetLocation();
            int aTeam = attacker.GetTeamNum2();

            // Demo effectuee dans sa propre moitie -> demolition defensive
            if ((aTeam == 0 && aloc.Y < 0) || (aTeam == 1 && aloc.Y > 0))
            {
                stats[attacker.GetPlayerName().ToString()].defensiveDemos++;
                if (debugEnabled)
                {
                    float time = gameWrapper->GetCurrentGameState().GetSecondsElapsed();
                    Log("[DEBUG] Demo defensive par " + attacker.GetPlayerName().ToString() + " t:" + std::to_string(time));
                }
            }

            // Demo effectuee dans la moitie adverse -> demolition offensive
            if ((aTeam == 0 && aloc.Y > 0) || (aTeam == 1 && aloc.Y < 0))
            {
                stats[attacker.GetPlayerName().ToString()].offensiveDemos++;
                if (debugEnabled)
                    Log("[DEBUG] Demo offensive par " + attacker.GetPlayerName().ToString());
            }
        }
    }
}

void AuusaConnectPlugin::OnBoostCollected(CarWrapper car, void* /*params*/, std::string)
{
    if (!car)
        return;

    BoostWrapper boost = car.GetBoostComponent();
    if (!boost)
        return;

    PriWrapper pri = car.GetPRI();
    if (!pri)
        return;

    std::string name = pri.GetPlayerName().ToString();
    PlayerStats &ps = stats[name];

    float current = boost.GetCurrentBoostAmount();
    float gained = ps.lastBoost >= 0.f ? current - ps.lastBoost : 0.f;

    ps.boostPickups++;
    if (ps.lastBoost >= 0.f && gained > 0.f)
    {
        if (ps.lastBoost >= boost.GetMaxBoostAmount() * 0.8f)
            ps.wastedBoosts++;
        if (gained > 90.f)
            ps.bigPads++;
        else
            ps.smallPads++;
    }
    ps.lastBoost = current;

    if (debugEnabled)
    {
        Vector loc = car.GetLocation();
        float time = gameWrapper->GetCurrentGameState().GetSecondsElapsed();
        Log("[DEBUG] Boost pickup " + name + " pos:" + std::to_string(loc.X) + "," + std::to_string(loc.Y) + " t:" + std::to_string(time));
    }
}

BAKKESMOD_PLUGIN(AuusaConnectPlugin, "AuusaConnect", "0.1", 0)

void AuusaConnectPlugin::OnGoalScored(std::string)
{
    ServerWrapper sw = gameWrapper->GetCurrentGameState();
    if (!sw)
        return;

    TeamWrapper blueTeam = sw.GetTeams().Get(0);
    TeamWrapper orangeTeam = sw.GetTeams().Get(1);
    int totalScore = 0;
    if (blueTeam)
        totalScore += blueTeam.GetScore();
    if (orangeTeam)
        totalScore += orangeTeam.GetScore();
    if (totalScore == lastTotalScore)
        return;
    lastTotalScore = totalScore;

    // Certaines versions du SDK ne fournissent pas la méthode GetLastGoalScorer.
    // On détermine donc le buteur à partir du dernier joueur ayant touché la balle.
    if (lastTouchPlayer.empty())
        return;

    PriWrapper scorer = GetPriByName(sw, lastTouchPlayer);
    if (!scorer)
        return;

    std::string name = lastTouchPlayer;
    stats[name].goals++;

    if (debugEnabled)
    {
        float time = sw.GetSecondsElapsed();
        Log("[DEBUG] But marque par " + name + " t:" + std::to_string(time));
    }

    int team = scorer.GetTeamNum2();
    std::string assister = lastTeamTouchPlayer[team];
    if (!assister.empty() && assister != name)
        stats[assister].assists++;
}

void AuusaConnectPlugin::Log(const std::string& msg)
{
    cvarManager->log(msg);
    if (logFile.is_open())
    {
        logFile << msg << std::endl;
        logFile.flush();
    }
}


