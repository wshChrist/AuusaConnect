#include "bakkesmod/plugin/bakkesmodplugin.h"
#include "bakkesmod/wrappers/WrapperStructs.h"
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

using json = nlohmann::json;

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

    std::map<std::string, PlayerStats> stats;
    std::string lastTouchPlayer;
    float lastTouchTime = 0.f;
    std::string lastTeamTouchPlayer[2];
    float lastTeamTouchTime[2] = {0.f, 0.f};
    Vector lastBallLocation{0.f, 0.f, 0.f};
    Vector lastBallVel;
    float lastUpdate = 0.f;
    bool debugEnabled = false;
    std::ofstream logFile;
    void Log(const std::string& msg);
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

void MatchmakingPlugin::onLoad()
{
    cvarManager->registerCvar("mm_debug", "0", "Active le mode debug").addOnValueChanged([this](std::string, CVarWrapper cvar){
        debugEnabled = cvar.getBoolValue();
    });
    debugEnabled = cvarManager->getCvar("mm_debug").getBoolValue();
    std::filesystem::path logPath = gameWrapper->GetDataFolder() / "matchmaking.log";
    logFile.open(logPath.string(), std::ios::app);
    Log("Plugin loaded");
    HookEvents();
}

void MatchmakingPlugin::onUnload()
{
    Log("Plugin unloaded");
    if (logFile.is_open())
        logFile.close();
}

void MatchmakingPlugin::HookEvents()
{
    gameWrapper->HookEventWithCallerPost<ServerWrapper>(
        "Function TAGame.GameEvent_Soccar_TA.EventMatchStarted",
        std::bind(&MatchmakingPlugin::OnMatchStart, this,
                  std::placeholders::_1, std::placeholders::_2, std::placeholders::_3));
    gameWrapper->HookEventPost(
        "Function TAGame.GameEvent_Soccar_TA.EventMatchEnded",
        std::bind(&MatchmakingPlugin::OnGameEnd, this));

    gameWrapper->HookEventWithCallerPost<CarWrapper>(
        "Function TAGame.Car_TA.EventHitBall",
        std::bind(&MatchmakingPlugin::OnHitBall, this,
                  std::placeholders::_1, std::placeholders::_2, std::placeholders::_3));
    gameWrapper->HookEventWithCallerPost<CarWrapper>(
        "Function TAGame.Car_TA.EventDemolish",
        std::bind(&MatchmakingPlugin::OnCarDemolish, this,
                  std::placeholders::_1, std::placeholders::_2, std::placeholders::_3));

    gameWrapper->HookEventWithCallerPost<CarWrapper>(
        "Function TAGame.CarComponent_Boost_TA.OnPickup",
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
            {"doubleCommits", ps.doubleCommits}
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

    cpr::Response r = cpr::Post(cpr::Url{"http://localhost:3000/match"},
                                cpr::Body{payload.dump()},
                                cpr::Header{{"Content-Type", "application/json"}});
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

    if (WasLastShotOnGoal(ball))
    {
        bool defenderNearby = false;
        for (int i = 0; i < pris.Count(); ++i)
        {
            PriWrapper opp = pris.Get(i);
            if (!opp || opp.GetTeamNum2() == team)
                continue;
            CarWrapper oc = opp.GetCar();
            if (!oc)
                continue;
            if ((oc.GetLocation() - ball.GetLocation()).magnitude() < 2000.f)
            {
                defenderNearby = true;
                break;
            }
        }
        if (!defenderNearby)
            ps.missedOpenGoals++;
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
        logFile << msg << std::endl;
}


