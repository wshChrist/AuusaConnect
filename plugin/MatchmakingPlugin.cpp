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
    // Statistiques offensives
    int goals = 0;
    int assists = 0;
    int shotsOnTarget = 0;
    int offensiveDemos = 0;
    int offensiveParticipation = 0;
    float timeInAttack = 0.f;
    int highPressings = 0;
    // Statistiques d'intelligence de jeu
    float respectedRotation = 0.f;
    float rotationOpportunities = 0.f;
    int rotationCuts = 0;
    int smartBoosts = 0;
    float thirdManRespect = 0.f;
    float thirdManOpportunities = 0.f;
    float shadowDefenseTime = 0.f;
    int slowPlays = 0;
    int supportPositions = 0;
    // Vision & Soutien
    int usefulPasses = 0;
    int followUps = 0;
    int cleanClears = 0;
    float passAvailableTime = 0.f;
    // Mobilite & Activite
    float speedSum = 0.f;
    float usedBoost = 0.f;
    float effectiveBoost = 0.f;
    int aerialTouches = 0;
    int offBallMoves = 0;
    int ballTouches = 0;
    // Erreurs / Malus
    int doubleCommits = 0;
    int boostSteals = 0;
    int missedOpenGoals = 0;
    int badPositions = 0;
    int boostOveruses = 0;
    int uselessTouches = 0;
    // Etats internes pour le calcul
    bool inAttack = false;
    float timeSinceAttack = 0.f;
    Vector lastLocation{0.f,0.f,0.f};
    bool wasAhead = false;
};

class MatchmakingPlugin : public BakkesMod::Plugin::BakkesModPlugin
{
public:
    void onLoad() override;
    void onUnload() override;

private:
    void HookEvents();
    void OnMatchStart(ServerWrapper server);
    void TickBoost();
    void OnGameEnd();
    void OnGoalScored(std::string eventName);
    void OnBallTouch(std::string eventName);
    void OnDemolition(std::string eventName);

    std::map<std::string, PlayerStats> stats;
    std::string lastTouchPlayer;
    float lastTouchTime = 0.f;
    std::string lastTeamTouchPlayer[2];
    float lastTeamTouchTime[2] = {0.f, 0.f};
    Vector lastBallLocation{0.f,0.f,0.f};
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

    gameWrapper->HookEventPost(
        "Function TAGame.GameEvent_Soccar_TA.OnGoalScored",
        std::bind(&MatchmakingPlugin::OnGoalScored, this, std::placeholders::_1));
    gameWrapper->HookEventPost(
        "Function TAGame.Ball_TA.EventHit",
        std::bind(&MatchmakingPlugin::OnBallTouch, this, std::placeholders::_1));
    gameWrapper->HookEventPost(
        "Function TAGame.Car_TA.EventDemolished",
        std::bind(&MatchmakingPlugin::OnDemolition, this, std::placeholders::_1));
}

void MatchmakingPlugin::OnMatchStart(ServerWrapper server)
{
    stats.clear();
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
        PlayerStats &ps = stats[pri.GetPlayerName().ToString()];
        CarWrapper car = pri.GetCar();
        if (car)
            ps.lastLocation = car.GetLocation();
    }
    TickBoost();
}

void MatchmakingPlugin::TickBoost()
{
    ServerWrapper sw = gameWrapper->GetCurrentGameState();
    if (sw)
    {
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
            if (!boost)
                continue;

            PlayerStats &ps = stats[name];
            Vector location = car.GetLocation();
            bool ahead = (pri.GetTeamNum2() == 0 && location.X > ballLoc.X) ||
                         (pri.GetTeamNum2() == 1 && location.X < ballLoc.X);
            bool behind = !ahead;
            bool onOffense = (pri.GetTeamNum2() == 0 && location.X > 0) ||
                             (pri.GetTeamNum2() == 1 && location.X < 0);
            if (onOffense)
                ps.timeInAttack += 0.1f;

            if (lastTeamTouchPlayer[pri.GetTeamNum2()] != name &&
                gameWrapper->GetCurrentGameState()->GetSecondsElapsed() - lastTeamTouchTime[pri.GetTeamNum2()] < 2.f &&
                (location - ballLoc).magnitude() < 1500.f && speed > 500.f)
                ps.followUps++;

            ps.totalTime += 0.1f;
            float speed = car.GetVelocity().magnitude();
            ps.speedSum += speed;

            // Respect des rotations apres une phase offensive
            if (ps.inAttack)
            {
                ps.rotationOpportunities += 0.1f;
                if (behind)
                    ps.respectedRotation += 0.1f;
                ps.timeSinceAttack += 0.1f;
                if (ps.timeSinceAttack > 3.f)
                    ps.inAttack = false;
            }

            // Troisieme homme
            int matesAhead = 0;
            for (int j = 0; j < pris.Count(); ++j)
            {
                if (j == i)
                    continue;
                PriWrapper other = pris.Get(j);
                if (!other || other.GetTeamNum2() != pri.GetTeamNum2())
                    continue;
                CarWrapper otherCar = other.GetCar();
                if (!otherCar)
                    continue;
                Vector oloc = otherCar.GetLocation();
                bool oahead = (pri.GetTeamNum2() == 0 && oloc.X > ballLoc.X) ||
                              (pri.GetTeamNum2() == 1 && oloc.X < ballLoc.X);
                if (oahead)
                    matesAhead++;
            }
            if (matesAhead >= 2)
            {
                ps.thirdManOpportunities += 0.1f;
                if (behind)
                    ps.thirdManRespect += 0.1f;
            }

            // Shadow defense simple : joueur derriere la balle et vitesse vers son but
            Vector vel = car.GetVelocity();
            bool retreating = (pri.GetTeamNum2() == 0 && vel.X < 0) ||
                              (pri.GetTeamNum2() == 1 && vel.X > 0);
            if (behind && retreating)
                ps.shadowDefenseTime += 0.1f;

            // Rotation cut detection
            if (ahead && !ps.wasAhead && matesAhead >= 1)
                ps.rotationCuts++;
            ps.wasAhead = ahead;

            float current = boost.GetCurrentBoostAmount();
            if (ps.lastBoost >= 0 && current - ps.lastBoost > 1.f)
            {
                ps.boostPickups++;
                bool transition = (pri.GetTeamNum2() == 0 && vel.X > 0) ||
                                   (pri.GetTeamNum2() == 1 && vel.X < 0);
                if (transition && matesAhead == 0)
                    ps.smartBoosts++;
                if (ps.lastBoost >= boost.GetMaxBoostAmount() * 0.8f)
                    ps.wastedBoosts++;
                if (current - ps.lastBoost > 90.f)
                    ps.bigPads++;
                else
                    ps.smallPads++;
                // Vol de boost inutile
                for (int j = 0; j < pris.Count(); ++j)
                {
                    if (j == i)
                        continue;
                    PriWrapper mate = pris.Get(j);
                    if (!mate || mate.GetTeamNum2() != pri.GetTeamNum2())
                        continue;
                    CarWrapper mateCar = mate.GetCar();
                    if (!mateCar)
                        continue;
                    BoostWrapper mateBoost = mateCar.GetBoostComponent();
                    if (!mateBoost)
                        continue;
                    float dist = (mateCar.GetLocation() - location).magnitude();
                    if (dist < 500.f && mateBoost.GetCurrentBoostAmount() < 30.f && ps.lastBoost > 70.f)
                    {
                        ps.boostSteals++;
                        break;
                    }
                }
            }
            if (ps.lastBoost >= 0 && current < ps.lastBoost)
            {
                ps.usedBoost += ps.lastBoost - current;
                if (speed > 400.f)
                    ps.effectiveBoost += ps.lastBoost - current;
                if (speed > 2200.f)
                    ps.boostOveruses++;
            }
            ps.lastBoost = current;

            // Detection des positions de support
            float distBall = (location - ballLoc).magnitude();
            if (distBall > 1000.f && distBall < 2000.f && behind)
                ps.supportPositions++;
            if (behind && distBall < 1500.f)
                ps.passAvailableTime += 0.1f;

            // Mouvement sans ballon
            if (distBall > 1500.f && speed > 600.f)
                ps.offBallMoves++;

            // Ralentir le jeu : vitesse lente en possession
            float ballSpeed = ball.GetVelocity().magnitude();
            if (ps.inAttack && speed < 700.f && ballSpeed < 700.f)
                ps.slowPlays++;

            // Mauvais positionnement
            if (ahead && matesAhead >= 2)
                ps.badPositions++;

            ps.lastLocation = location;
        }
    }
    gameWrapper->SetTimeout(std::bind(&MatchmakingPlugin::TickBoost, this), 0.1f);
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
            {"offensiveDemos", ps.offensiveDemos},
            {"participation", ps.offensiveParticipation},
            {"attackTime", ps.timeInAttack},
            {"pressings", ps.highPressings},
            {"rotationRespect", ps.rotationOpportunities > 0 ? ps.respectedRotation / ps.rotationOpportunities : 1},
            {"rotationCuts", ps.rotationCuts},
            {"smartBoostRatio", ps.boostPickups > 0 ? (float)ps.smartBoosts / ps.boostPickups : 0},
            {"thirdManRespect", ps.thirdManOpportunities > 0 ? ps.thirdManRespect / ps.thirdManOpportunities : 1},
            {"shadowDefense", ps.shadowDefenseTime},
            {"slowPlays", ps.slowPlays},
            {"supportPositions", ps.supportPositions},
            {"usefulPasses", ps.usefulPasses},
            {"followUps", ps.followUps},
            {"cleanClears", ps.cleanClears},
            {"passAvailability", ps.totalTime > 0 ? ps.passAvailableTime / ps.totalTime : 0},
            {"averageSpeed", ps.totalTime > 0 ? ps.speedSum / ps.totalTime : 0},
            {"boostEfficiency", ps.usedBoost > 0 ? ps.effectiveBoost / ps.usedBoost : 0},
            {"aerialTouches", ps.aerialTouches},
            {"offBallMoves", ps.offBallMoves},
            {"touchesPerMinute", ps.totalTime > 0 ? (ps.ballTouches / ps.totalTime) * 60.f : 0},
            {"doubleCommits", ps.doubleCommits},
            {"boostSteals", ps.boostSteals},
            {"missedOpens", ps.missedOpenGoals},
            {"badPositions", ps.badPositions},
            {"boostOveruses", ps.boostOveruses},
            {"uselessTouches", ps.uselessTouches}
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
