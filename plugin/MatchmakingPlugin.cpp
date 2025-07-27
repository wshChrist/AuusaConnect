#include "bakkesmod/plugin/bakkesmodplugin.h"
#include "bakkesmod/wrappers/WrapperStructs.h"
#include <cpr/cpr.h>
#include <nlohmann/json.hpp>
#include <vector>
#include <string>

using json = nlohmann::json;

struct PlayerStats
{
    int boostPickups = 0;
    int wastedBoosts = 0;
    int smallPads = 0;
    int bigPads = 0;
    float lastBoost = -1.f;

    // Statistiques defensives
    int clearances = 0;
    int challengesWon = 0;
    int defensiveDemos = 0;
    float defenseTime = 0.f;
    int clutchSaves = 0;
    int blocks = 0;
    int prevSaves = 0;
};

class MatchmakingPlugin : public BakkesMod::Plugin::BakkesModPlugin
{
public:
    void onLoad() override;
    void onUnload() override;

private:
    void HookEvents();
    void OnMatchStart(ServerWrapper server);
    void TickStats();
    void OnHitBall(CarWrapper car);
    void OnDemolition(CarWrapper car);
    void OnGameEnd();
    void OnGoalScored(std::string eventName);
    void OnBallTouch(std::string eventName);
    void OnDemolition(std::string eventName);

    std::map<std::string, PlayerStats> stats;
    Vector lastBallVel;
    float lastUpdate = 0.f;
};

void MatchmakingPlugin::onLoad()
{
    HookEvents();
}

void MatchmakingPlugin::onUnload()
{
}

void MatchmakingPlugin::HookEvents()
{
    gameWrapper->HookEventWithCallerPost<ServerWrapper>(
        "Function TAGame.GameEvent_Soccar_TA.EventMatchStarted",
        std::bind(&MatchmakingPlugin::OnMatchStart, this, std::placeholders::_1));
    gameWrapper->HookEventPost(
        "Function TAGame.GameEvent_Soccar_TA.EventMatchEnded",
        std::bind(&MatchmakingPlugin::OnGameEnd, this));

    gameWrapper->HookEventWithCallerPost<CarWrapper>(
        "Function TAGame.Car_TA.EventHitBall",
        std::bind(&MatchmakingPlugin::OnHitBall, this, std::placeholders::_1));
    gameWrapper->HookEventWithCallerPost<CarWrapper>(
        "Function TAGame.Car_TA.EventDemolish",
        std::bind(&MatchmakingPlugin::OnDemolition, this, std::placeholders::_1));
}

void MatchmakingPlugin::OnMatchStart(ServerWrapper server)
{
    stats.clear();
    lastUpdate = 0.f;
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
        BallWrapper ball = sw.GetBall();
        Vector ballLoc = ball.GetLocation();
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
                float current = boost.GetCurrentBoostAmount();
                if (ps.lastBoost >= 0 && current - ps.lastBoost > 1.f)
                {
                    ps.boostPickups++;
                    if (ps.lastBoost >= boost.GetMaxBoostAmount() * 0.8f)
                        ps.wastedBoosts++;
                    if (current - ps.lastBoost > 90.f)
                        ps.bigPads++;
                    else
                        ps.smallPads++;
                }
                ps.lastBoost = current;
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
        }
    }
    gameWrapper->SetTimeout(std::bind(&MatchmakingPlugin::TickStats, this), 0.1f);
}

void MatchmakingPlugin::OnGameEnd()
{
    ServerWrapper sw = gameWrapper->GetCurrentGameState();
    if (!sw)
        return;

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
            {"rotationQuality", ps.boostPickups > 0 ? (float)ps.smallPads / ps.boostPickups : 0},
            {"clearances", ps.clearances},
            {"defensiveChallenges", ps.challengesWon},
            {"defensiveDemos", ps.defensiveDemos},
            {"defenseTime", ps.defenseTime},
            {"clutchSaves", ps.clutchSaves},
            {"blocks", ps.blocks}
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

    cpr::Response r = cpr::Post(cpr::Url{"http://localhost:3000/match"},
                                cpr::Body{payload.dump()},
                                cpr::Header{{"Content-Type", "application/json"}});
}

void MatchmakingPlugin::OnHitBall(CarWrapper car)
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

    std::string name = pri.GetPlayerName().ToString();
    PlayerStats &ps = stats[name];

    Vector pos = car.GetLocation();
    Vector ballPos = ball.GetLocation();
    Vector ballVel = ball.GetVelocity();
    int team = pri.GetTeamNum2();

    // degagement : balle envoyee de sa moitie vers l'adversaire
    if ((team == 0 && pos.Y < 0 && ballPos.Y > 0) || (team == 1 && pos.Y > 0 && ballPos.Y < 0))
        ps.clearances++;

    // duel gagne dans sa moitie
    if ((team == 0 && pos.Y < 0) || (team == 1 && pos.Y > 0))
        ps.challengesWon++;

    // block si la balle allait vers le but et repart a l'oppose
    if ((team == 0 && lastBallVel.Y < 0 && ballVel.Y >= 0 && pos.Y < 0) ||
        (team == 1 && lastBallVel.Y > 0 && ballVel.Y <= 0 && pos.Y > 0))
        ps.blocks++;
}

void MatchmakingPlugin::OnDemolition(CarWrapper car)
{
    if (!car)
        return;

    PriWrapper pri = car.GetPRI();
    if (!pri)
        return;

    Vector pos = car.GetLocation();
    int team = pri.GetTeamNum2();
    if ((team == 0 && pos.Y < 0) || (team == 1 && pos.Y > 0))
    {
        PlayerStats &ps = stats[pri.GetPlayerName().ToString()];
        ps.defensiveDemos++;
    }
}

BAKKESMOD_PLUGIN(MatchmakingPlugin, "Matchmaking Plugin", "1.0", 0)

void MatchmakingPlugin::OnGoalScored(std::string)
{
    ServerWrapper sw = gameWrapper->GetCurrentGameState();
    if (!sw)
        return;

    PriWrapper scorer = sw.GetGameEventAsServer().GetLastGoalScorer();
    if (!scorer)
        return;

    std::string name = scorer.GetPlayerName().ToString();
    stats[name].goals++;

    if (!lastTouchPlayer.empty() && lastTouchPlayer != name)
        stats[lastTouchPlayer].assists++;
}

void MatchmakingPlugin::OnBallTouch(std::string)
{
    ServerWrapper sw = gameWrapper->GetCurrentGameState();
    if (!sw)
        return;

    PriWrapper pri = sw.GetBall().GetLastTouchPRI();
    if (!pri)
        return;

    float gameTime = sw.GetSecondsElapsed();
    std::string player = pri.GetPlayerName().ToString();

    // Passe utile
    if (!lastTouchPlayer.empty() && lastTouchPlayer != player)
    {
        PriWrapper prevPri = sw.GetPRIByName(lastTouchPlayer);
        if (prevPri && prevPri.GetTeamNum2() == pri.GetTeamNum2() && gameTime - lastTouchTime < 2.f)
            stats[lastTouchPlayer].usefulPasses++;
    }

    lastTouchPlayer = player;
    lastTouchTime = gameTime;
    lastTeamTouchPlayer[pri.GetTeamNum2()] = player;
    lastTeamTouchTime[pri.GetTeamNum2()] = gameTime;

    PlayerStats &ps = stats[player];
    ps.ballTouches++;
    ps.inAttack = true;
    ps.timeSinceAttack = 0.f;

    BallWrapper ball = sw.GetBall();
    if (ball.WasLastShotOnGoal())
        ps.shotsOnTarget++;

    // Relance propre
    Vector prevBall = lastBallLocation;
    Vector newBall = ball.GetLocation();
    if ((pri.GetTeamNum2() == 0 && prevBall.X < 0 && newBall.X > 0) ||
        (pri.GetTeamNum2() == 1 && prevBall.X > 0 && newBall.X < 0))
        ps.cleanClears++;

    // Open goal rate
    if (ball.WasLastShotOnGoal())
    {
        bool defenderNearby = false;
        for (int i = 0; i < sw.GetPRIs().Count(); ++i)
        {
            PriWrapper opp = sw.GetPRIs().Get(i);
            if (!opp || opp.GetTeamNum2() == pri.GetTeamNum2())
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
            ps.missedOpenGoals++; // comptera si le tir ne marque pas
    }

    // Double commit detection: autre joueur tres proche lors de la touche
    for (int i = 0; i < sw.GetPRIs().Count(); ++i)
    {
        PriWrapper other = sw.GetPRIs().Get(i);
        if (!other || other.GetTeamNum2() != pri.GetTeamNum2() || other.GetPlayerName().ToString() == player)
            continue;
        CarWrapper otherCar = other.GetCar();
        if (!otherCar)
            continue;
        float dist = (otherCar.GetLocation() - loc).magnitude();
        if (dist < 800.f && fabs(lastTeamTouchTime[pri.GetTeamNum2()] - gameTime) < 0.5f)
        {
            stats[player].doubleCommits++;
            stats[other.GetPlayerName().ToString()].doubleCommits++;
            break;
        }
    }

    // Touches inutiles: renvoi vers son propre camp
    Vector ballLoc = ball.GetLocation();
    if ((pri.GetTeamNum2() == 0 && ballLoc.X < lastBallLocation.X) ||
        (pri.GetTeamNum2() == 1 && ballLoc.X > lastBallLocation.X))
        ps.uselessTouches++;
    lastBallLocation = ballLoc;

    if (!pri.GetCar().HasWheelContact())
        ps.aerialTouches++;

    Vector loc = pri.GetCar().GetLocation();
    if ((pri.GetTeamNum2() == 0 && loc.X > 0) || (pri.GetTeamNum2() == 1 && loc.X < 0))
        ps.highPressings++;
}

void MatchmakingPlugin::OnDemolition(std::string)
{
    ServerWrapper sw = gameWrapper->GetCurrentGameState();
    if (!sw)
        return;

    CarWrapper attacker = sw.GetVehicleToBeDemolisher();
    if (!attacker)
        return;

    PriWrapper pri = attacker.GetPRI();
    if (!pri)
        return;

    Vector loc = attacker.GetLocation();
    if ((pri.GetTeamNum2() == 0 && loc.X > 0) || (pri.GetTeamNum2() == 1 && loc.X < 0))
        stats[pri.GetPlayerName().ToString()].offensiveDemos++;
}
