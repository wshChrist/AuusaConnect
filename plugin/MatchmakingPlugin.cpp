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
#include <ctime>

using json = nlohmann::json;

static std::string Base64UrlDecode(const std::string& input)
{
    std::string temp = input;
    std::replace(temp.begin(), temp.end(), '-', '+');
    std::replace(temp.begin(), temp.end(), '_', '/');
    while (temp.size() % 4 != 0)
        temp += '=';
    static const std::string chars =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    std::string out;
    int val = 0, valb = -8;
    for (unsigned char c : temp)
    {
        if (c == '=')
            break;
        int idx = chars.find(c);
        if (idx == std::string::npos)
            break;
        val = (val << 6) + idx;
        valb += 6;
        if (valb >= 0)
        {
            out.push_back(char((val >> valb) & 0xFF));
            valb -= 8;
        }
    }
    return out;
}

static std::time_t ParseJwtExpiry(const std::string& token)
{
    size_t first = token.find('.') + 1;
    size_t second = token.find('.', first);
    if (first == std::string::npos || second == std::string::npos)
        return 0;
    std::string payload = token.substr(first, second - first);
    std::string decoded = Base64UrlDecode(payload);
    auto j = json::parse(decoded, nullptr, false);
    if (j.is_discarded())
        return 0;
    return j.value("exp", 0);
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

    std::vector<float> xgAttempts;
    std::vector<std::string> xgContext;
};

struct DefenderInfo {
    Vector pos;
    float boost;
    bool padNearby;
};

class MatchmakingPlugin : public BakkesMod::Plugin::BakkesModPlugin
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
    static float ComputeXGAdvanced(float distance, float angle, float ballSpeed, bool hasBoost, bool isAerial, const std::vector<DefenderInfo>& defenders, bool hardRebound, bool panicShot, bool openNet, bool qualityAction);

    void PollSupabase();
    void LoadConfig();
    void RefreshJwt();

    std::map<std::string, PlayerStats> stats;
    std::string lastTouchPlayer;
    float lastTouchTime = 0.f;
    bool lastTouchAerial = false;
    std::string lastTeamTouchPlayer[2];
    float lastTeamTouchTime[2] = {0.f, 0.f};
    Vector lastBallLocation{0.f, 0.f, 0.f};
    Vector lastBallVel;
    float lastUpdate = 0.f;
    bool debugEnabled = false;
    std::ofstream logFile;
    void Log(const std::string& msg);
    std::string supabaseUrl;
    std::string supabaseApiKey;
    std::string supabaseJwt;
    std::time_t jwtExpiry = 0;
    std::string lastSupabaseName;
    std::string lastSupabasePassword;
    bool supabaseDisabled = false;
    std::string botEndpoint = "http://localhost:3000/match";
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

float MatchmakingPlugin::ComputeXGAdvanced(float distance, float angle, float ballSpeed, bool hasBoost, bool isAerial, const std::vector<DefenderInfo>& defenders, bool hardRebound, bool panicShot, bool openNet, bool qualityAction)
{
    float xg = 0.05f;
    xg += std::clamp(1.f - distance / 5000.f, 0.f, 1.f) * 0.3f;
    xg += std::clamp(1.f - angle / 1.57f, 0.f, 1.f) * 0.3f;
    xg += std::clamp(ballSpeed / 3000.f, 0.f, 1.f) * 0.1f;
    if (hasBoost)
        xg += 0.05f;
    if (isAerial)
        xg -= 0.05f;
    for (const auto& d : defenders)
    {
        if (d.boost > 20.f || d.padNearby)
            xg -= 0.05f;
    }
    if (hardRebound)
        xg -= 0.05f;
    if (panicShot)
        xg -= 0.1f;
    if (openNet)
        xg += 0.4f;
    if (qualityAction)
        xg += 0.1f;
    return std::clamp(xg, 0.f, 1.f);
}

std::string MatchmakingPlugin::DetectShotContext(CarWrapper car, BallWrapper ball, int team, bool openNet, float gameTime, bool isAerial)
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

void MatchmakingPlugin::onLoad()
{
    cvarManager->registerCvar("mm_debug", "0", "Active le mode debug").addOnValueChanged([this](std::string, CVarWrapper cvar){
        debugEnabled = cvar.getBoolValue();
    });
    cvarManager->registerCvar("mm_player_id", "unknown", "Identifiant Supabase du joueur")
        .addOnValueChanged([this](std::string, CVarWrapper cvar){
            std::string val = cvar.getStringValue();
            if(!val.empty() && val != "unknown")
            {
                supabaseDisabled = false;
                PollSupabase();
            }
        });
    cvarManager->registerNotifier(
        "mm_show_credentials",
        [this](std::vector<std::string>) {
            if (lastSupabaseName.empty())
                Log("Aucun credential Supabase en memoire");
            else
                Log("rl_name=" + lastSupabaseName + ", rl_password=" + lastSupabasePassword);
        },
        "Affiche les dernieres informations recuperees depuis Supabase",
        PERMISSION_ALL);
    cvarManager->registerNotifier(
        "mm_help",
        [this](std::vector<std::string>) {
            Log("Pour configurer l'identifiant joueur, utilisez la commande mm_player_id <votre_id_supabase>");
        },
        "Affiche l'aide de configuration du matchmaking",
        PERMISSION_ALL);
    cvarManager->registerNotifier(
        "mm_poll_now",
        [this](std::vector<std::string>) { PollSupabase(); },
        "Force une verification immediate de Supabase",
        PERMISSION_ALL);
    debugEnabled = cvarManager->getCvar("mm_debug").getBoolValue();
    std::filesystem::path logPath = gameWrapper->GetDataFolder() / "matchmaking.log";
    logFile.open(logPath.string(), std::ios::app);
    Log("Plugin loaded");
    LoadConfig();
    HookEvents();

    PollSupabase();
}

void MatchmakingPlugin::onUnload()
{
    Log("Plugin unloaded");
    if (logFile.is_open())
        logFile.close();
}

void MatchmakingPlugin::LoadConfig()
{
    std::filesystem::path path = gameWrapper->GetDataFolder() / "config.json";
    std::ifstream file(path);
    if (!file.is_open())
    {
        Log("[Config] Impossible de lire " + path.string());
        supabaseUrl.clear();
        supabaseApiKey.clear();
        supabaseJwt.clear();
        jwtExpiry = 0;
        return;
    }

    json cfg = json::parse(file, nullptr, false);
    if (cfg.is_discarded())
    {
        Log("[Config] JSON invalide dans " + path.string());
        return;
    }

    supabaseUrl = cfg.value("SUPABASE_URL", "");
    supabaseApiKey = cfg.value("SUPABASE_API_KEY", "");
    supabaseJwt = cfg.value("SUPABASE_JWT", "");
    jwtExpiry = ParseJwtExpiry(supabaseJwt);
    if (jwtExpiry == 0)
        Log("[Config] Date d'expiration du JWT introuvable");
    botEndpoint = cfg.value("BOT_ENDPOINT", "http://localhost:3000/match");
    Log("[Config] BOT_ENDPOINT=" + botEndpoint);
}

void MatchmakingPlugin::PollSupabase()
{
    if (supabaseDisabled)
        return;

    // Ne pas interroger Supabase si l'on est déjà dans une partie en ligne.
    // `IsInGame()` renvoie également vrai en entraînement ou en freeplay,
    // ce qui empêchait toute requête lorsqu'on attendait dans ces modes.
    if (gameWrapper->IsInOnlineGame())
    {
        Log("[Supabase] Requête ignorée : déjà en partie en ligne");
        gameWrapper->SetTimeout(std::bind(&MatchmakingPlugin::PollSupabase, this), 3.0f);
        return;
    }

    if (jwtExpiry != 0 && std::time(nullptr) >= jwtExpiry)
    {
        Log("[Supabase] JWT expiré, rafraîchissement...");
        RefreshJwt();
        if (jwtExpiry != 0 && std::time(nullptr) >= jwtExpiry)
        {
            Log("[Supabase] JWT toujours expiré après tentative de rafraîchissement");
            return;
        }
    }

    std::string playerId = cvarManager->getCvar("mm_player_id").getStringValue();
    if (playerId.empty() || playerId == "unknown")
    {
        Log("mm_player_id manquant ou \"unknown\". Configurez-le via la commande mm_player_id <votre_id>");
        supabaseDisabled = true;
        return;
    }
    gameWrapper->SetTimeout(std::bind(&MatchmakingPlugin::PollSupabase, this), 3.0f);
    if (supabaseUrl.empty() || supabaseApiKey.empty() || supabaseJwt.empty())
    {
        Log("[Supabase] Configuration Supabase incomplète");
        return;
    }

    std::thread([this, playerId]() {
        try
        {
            auto headers = cpr::Header{{"Authorization", "Bearer " + supabaseJwt}, {"apikey", supabaseApiKey}};
            cpr::Response r = cpr::Get(cpr::Url{supabaseUrl}, cpr::Parameters{{"player_id", "eq." + playerId}}, headers);
            if (r.status_code != 200)
            {
                Log("[Supabase] Erreur HTTP " + std::to_string(r.status_code) + ": " + r.text);
                return;
            }
            auto arr = json::parse(r.text, nullptr, false);
            if (!arr.is_array() || arr.empty())
            {
                Log("[Supabase] Réponse JSON vide ou invalide: " + r.text);
                return;
            }
            auto instr = arr.at(0);
            std::string name = instr.value("rl_name", "");
            std::string password = instr.value("rl_password", "");
            if (name.empty())
            {
                Log("[Supabase] Champ rl_name absent, aucune création de partie");
                return;
            }
            lastSupabaseName = name;
            lastSupabasePassword = password;
            Log("[Supabase] rl_name=" + name + ", rl_password=" + password);
            gameWrapper->Execute([this, name, password](GameWrapper* gw) {
                auto mm = gw->GetMatchmakingWrapper();
                if (mm)
                {
                    CustomMatchSettings settings{};
                    settings.ServerName = name;
                    settings.Password = password;
                    settings.MapName = "Stadium_P";
                    mm.CreatePrivateMatch(Region::EU, static_cast<int>(PlaylistIds::PrivateMatch), settings);
                    gw->Toast("Matchmaking", "\xF0\x9F\x8E\xAE Partie créée automatiquement", "default", 3.0f);
                }
            });

            cpr::Delete(cpr::Url{supabaseUrl}, cpr::Parameters{{"player_id", "eq." + playerId}}, headers);
        }
        catch (const std::exception& e)
        {
            Log(std::string("[Supabase] Exception: ") + e.what());
        }
        catch (...)
        {
            Log("[Supabase] Exception inconnue lors de la requête");
        }
    }).detach();
}

void MatchmakingPlugin::RefreshJwt()
{
    LoadConfig();
    if (jwtExpiry != 0 && std::time(nullptr) < jwtExpiry)
        Log("[Supabase] JWT rafraîchi");
    else
        Log("[Supabase] Impossible de rafraîchir le JWT");
}

void MatchmakingPlugin::HookEvents()
{
    gameWrapper->HookEventWithCallerPost<ServerWrapper>(
        "Function TAGame.GameEvent_Soccar_TA.OnGameStarted",
        std::bind(&MatchmakingPlugin::OnMatchStart, this,
                  std::placeholders::_1, std::placeholders::_2, std::placeholders::_3));
    gameWrapper->HookEventPost(
        "Function TAGame.GameEvent_Soccar_TA.OnGameEnded",
        std::bind(&MatchmakingPlugin::OnGameEnd, this));

    gameWrapper->HookEventWithCallerPost<CarWrapper>(
        "Function TAGame.Car_TA.OnHitBall",
        std::bind(&MatchmakingPlugin::OnHitBall, this,
                  std::placeholders::_1, std::placeholders::_2, std::placeholders::_3));
    gameWrapper->HookEventWithCallerPost<CarWrapper>(
        "Function TAGame.Car_TA.OnDemolished",
        std::bind(&MatchmakingPlugin::OnCarDemolish, this,
                  std::placeholders::_1, std::placeholders::_2, std::placeholders::_3));

    gameWrapper->HookEventWithCallerPost<CarWrapper>(
        "Function TAGame.CarComponent_Boost_TA.OnBoostCollected",
        std::bind(&MatchmakingPlugin::OnBoostCollected, this,
                  std::placeholders::_1, std::placeholders::_2, std::placeholders::_3));

    gameWrapper->HookEventPost(
        "Function TAGame.GameEvent_Soccar_TA.OnGoalScored",
        std::bind(&MatchmakingPlugin::OnGoalScored, this, std::placeholders::_1));
    // On gère les démolitions directement dans OnCarDemolish,
    // cette écoute n'est plus nécessaire.
}

void MatchmakingPlugin::OnMatchStart(ServerWrapper server, void* /*params*/, std::string /*eventName*/)
{
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

void MatchmakingPlugin::TickStats()
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
    gameWrapper->SetTimeout(std::bind(&MatchmakingPlugin::TickStats, this), 0.1f);
}

void MatchmakingPlugin::OnGameEnd()
{
    try
    {
        Log("[OnGameEnd] Debut du traitement");
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

    json payload = {
        {"scoreBlue", scoreBlue},
        {"scoreOrange", scoreOrange},
        {"teamBlue", blueName},
        {"teamOrange", orangeName},
        {"scorers", scorers},
        {"mvp", mvp},
        {"players", players}
    };

    if (debugEnabled)
        Log("[DEBUG] Envoi des stats : " + std::to_string(players.size()) + " joueurs");

    gameWrapper->SetTimeout([payload = std::move(payload), url = botEndpoint](GameWrapper* /*gw*/) mutable
    {
        std::thread([p = std::move(payload), url]() mutable
        {
            try
            {
                auto res = cpr::Post(cpr::Url{url},
                                     cpr::Body{p.dump()},
                                     cpr::Header{{"Content-Type", "application/json"}});

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

void MatchmakingPlugin::OnHitBall(CarWrapper car, void* /*params*/, std::string /*eventName*/)
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
    float oppTouch = fabs(sw.GetSecondsElapsed() - lastTeamTouchTime[team == 0 ? 1 : 0]);
    if (oppNearby && oppTouch < 0.2f)
    {
        ps.challengesWon++;
        if (debugEnabled)
            Log("[DEBUG] Duel gagne par " + name);
    }

    // block si la balle allait vers le but et repart a l'oppose
    if ((team == 0 && lastBallVel.Y < 0 && ballVel.Y >= 0 && pos.Y < 0) ||
        (team == 1 && lastBallVel.Y > 0 && ballVel.Y <= 0 && pos.Y > 0))
    {
        ps.blocks++;
        if (debugEnabled)
            Log("[DEBUG] Block par " + name);
    }

    float gameTime = sw.GetSecondsElapsed();

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
            if ((opos - pos).magnitude() < 2000.f)
            {
                BoostWrapper ob = oc.GetBoostComponent();
                float oboost = ob ? ob.GetCurrentBoostAmount() : 0.f;
                defenders.push_back({opos, oboost, false});
            }
            if (((team == 0 && opos.Y > ballPos.Y) || (team == 1 && opos.Y < ballPos.Y)) &&
                std::fabs(opos.X - ballPos.X) < 800.f && (oc.GetBoostComponent() ? oc.GetBoostComponent().GetCurrentBoostAmount() : 0.f) > 5.f)
            {
                openNet = false;
            }
        }
        if (openNet)
            ps.missedOpenGoals++;

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

        float xg = ComputeXGAdvanced(distance, angle, ballVel.magnitude(), playerBoost > 0.f, isAerial, defenders, hardRebound, panicShot, openNet, quality);
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

    if ((team == 0 && loc.X > 0) || (team == 1 && loc.X < 0))
        ps.highPressings++;
}

void MatchmakingPlugin::OnCarDemolish(CarWrapper car, void* /*params*/, std::string /*eventName*/)
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

void MatchmakingPlugin::OnBoostCollected(CarWrapper car, void* /*params*/, std::string)
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

BAKKESMOD_PLUGIN(MatchmakingPlugin, "Matchmaking Plugin", "1.0", 0)

void MatchmakingPlugin::OnGoalScored(std::string)
{
    ServerWrapper sw = gameWrapper->GetCurrentGameState();
    if (!sw)
        return;

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

void MatchmakingPlugin::Log(const std::string& msg)
{
    cvarManager->log(msg);
    if (logFile.is_open())
    {
        logFile << msg << std::endl;
        logFile.flush();
    }
}


